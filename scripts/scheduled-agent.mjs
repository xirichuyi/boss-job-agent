import { AGENT } from '../src/agent-config.js';
import { ROOT } from '../src/project-root.js';
import { readState, harness } from '../src/harness-store.js';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { atomicJson, atomicBatch, shanghaiDay, cycleStatus, reconcileQuota } from '../src/schedule-state.js';
import { recoveryPlan, retryDelay } from '../src/autonomy.js';
import { raiseAlert } from '../src/alerts.js';
import { cooldown } from '../src/model-budget.js';
import { MODEL, REASONING_EFFORT } from '../src/model-config.js';
const root = ROOT;
const store = harness();
if (!store) throw Error('Harness尚未迁移');
const lease = store.acquire();
if (!lease) { console.log('executor_already_running'); process.exit(0); }
process.env.JOB_AGENT_LEASE = lease;
process.on('exit', () => store.release(lease));
const config = { ...readState(root + '/memory/schedule.json'), ...AGENT.schedule };
const statusPath = root + '/memory/scheduler-status.json';
function status(state, extra = {}) {
  const data = { checkedAt: new Date().toISOString(), state, ...extra };
  atomicJson(statusPath, data);
  console.log(JSON.stringify(data));
}
if (process.env.JOB_AGENT_FORCE === '1') harness()?.enqueue('manual');
const queued = (harness()?.pending().length || 0) > 0;
if (Date.parse(readState(root + '/memory/maintenance.json', {}).until || '') > Date.now()) { status('maintenance'); process.exit(0); }
if (!config.enabled) { status('disabled'); process.exit(0); }
const budget = cooldown(root);
if (budget) { status('model_cooldown', { nextAt: budget.until, reason: MODEL + '限额，冷却期间不领取新任务、不调用模型' }); process.exit(0); }
if (!Number.isInteger(config.perRun) || config.perRun < 0 || config.perRun > 10 || !Number.isInteger(config.dailyNewContactLimit) || config.dailyNewContactLimit < 1 || config.dailyNewContactLimit > 70) throw new Error('Invalid contact limits');
// Installing the timer does not imply that the send/receipt adapters are ready.
if (!config.automationReady) { status('paused', { reason: config.phase }); process.exit(0); }
if (!/^[0-9a-f-]{36}$/.test(config.threadId)) throw new Error('Invalid dedicated thread id');
const outstanding = root + '/memory/scheduled-cycle.json';
const retryPath = root + '/memory/retry-state.json';
let retry = readState(retryPath, { attempts: 0 });
let previous;
if (readState(outstanding)) {
  previous = readState(outstanding);
  const due = ['completed', 'skipped', 'quarantined'].includes(previous.status)
    ? Date.parse(previous.at) + config.intervalMinutes * 60000 : Date.parse(retry.nextAt || '') || 0;
  if (!queued && due > Date.now()) {
    status('waiting', { cycle: previous.id, nextAt: new Date(due).toISOString(), lastResult: previous.result, lastSummary: previous.summary }); process.exit(0);
  }
  if (!['completed', 'skipped', 'quarantined'].includes(previous.status)) {
    const file = `${root}/memory/cycles/${previous.id}.json`;
    const report = readState(file);
    const ledgerPath = root + '/memory/outreach-ledger.json';
    const ledger = readState(ledgerPath, { contacts: [] });
    let plan = recoveryPlan(previous, report, ledger);
    if (plan.action === 'authentication') {
      const health = spawnSync(process.execPath, [root + '/scripts/browser-health.mjs'], { cwd: root, timeout: 20000, stdio: 'ignore' });
      if (health.status === 0) plan = recoveryPlan(previous, report, ledger, true);
    }
    if (plan.action === 'review' || plan.action === 'authentication') {
      raiseAlert(root, { kind: plan.action, cycle: previous.id, reason: plan.reason });
      retry.nextAt = new Date(Date.now() + 5 * 60000).toISOString(); atomicJson(retryPath, retry);
      status('manual_required', { cycle: previous.id, reason: plan.reason, nextAt: retry.nextAt }); process.exit(0);
    }
    if (plan.action === 'quarantine') {
      for (const entry of ledger.contacts) {
        if ((entry.cycle === previous.id && entry.status === 'outcome_unknown') || plan.unresolved.includes(entry.job.id)) {
          entry.status = 'quarantined'; entry.quarantineReason = plan.reason;
          raiseAlert(root, { kind: 'unknown_send', cycle: previous.id, contact: entry.job.id, reason: '某联系人的发送结果不明，已隔离，禁止自动重发。其他岗位继续。' });
        }
      }
      atomicJson(ledgerPath, ledger);
      previous.status = 'quarantined'; // Deliberately NOT settled/refunded.
    } else {
      previous.status = 'skipped'; previous.result = plan.result;
    }
    previous.recovery = { at: new Date().toISOString(), action: plan.action, reason: plan.reason };
    atomicJson(outstanding, previous);
  }
}
const cycle = { id: crypto.randomUUID(), status: 'queued', at: new Date().toISOString() };
const quotaPath = root + '/memory/contact-quota.json';
const date = shanghaiDay();
let quota = readState(quotaPath, { date, reserved: 0 });
if (quota.date !== date) quota = { date, reserved: 0 };
if (!Number.isInteger(quota.reserved) || quota.reserved < 0) throw new Error('Invalid quota state');
quota = reconcileQuota(quota, previous);
const allocation = Math.max(0, Math.min(config.perRun, config.dailyNewContactLimit - quota.reserved));
cycle.newContactAllocation = allocation;
quota.reserved += allocation;
// Reserve before dispatch; never automatically release uncertain attempts.
harness().enqueue('timer', 'timer:' + cycle.id);
atomicBatch([[quotaPath, quota], [outstanding, cycle], [`${root}/memory/cycles/${cycle.id}.json`, {
  id: cycle.id, startedAt: cycle.at, status: 'queued', intents: [], receipts: [], jobReviews: [],
  result: { newContacts: 0, messagesSent: 0, repliesSent: 0, attachmentsSent: 0 }
}]], cycle.id);
fs.mkdirSync(root + '/memory/cycles', { recursive: true, mode: 0o700 });
cycle.status = 'running';
cycle.startedAt = new Date().toISOString();
atomicJson(outstanding, cycle);
const logPath = `${root}/memory/cycles/${cycle.id}.events.jsonl`;
const log = fs.openSync(logPath, 'wx', 0o600);
status('running', { cycle: cycle.id, model: MODEL, reasoningEffort: REASONING_EFFORT, logPath });
// The Python supervisor owns the process group and the hard deadline.
const result = spawnSync(process.execPath, [root + '/scripts/run-cycle.mjs'], { cwd: root, stdio: ['ignore', log, log] });
fs.closeSync(log);
let finished = readState(outstanding);
if (finished.id !== cycle.id || !['completed', 'blocked'].includes(finished.status) || !Number.isInteger(finished.result?.newContacts) || finished.result.newContacts < 0 || finished.result.newContacts > allocation) {
  finished = { ...cycle, status: 'blocked', reason: 'worker_failed_or_result_unconfirmed', completedAt: new Date().toISOString(), exitCode: result.status };
  atomicJson(outstanding, finished);
  process.exitCode = 1;
}
status(finished.status, { cycle: cycle.id, reason: finished.reason, result: finished.result, logPath });
if (finished.status === 'completed') {
  atomicJson(retryPath, { attempts: 0 });
} else {
  retry.attempts = (retry.attempts || 0) + 1;
  retry.nextAt = new Date(Date.now() + retryDelay(retry.attempts)).toISOString();
  atomicJson(retryPath, retry);
  raiseAlert(root, { kind: /登录|验证|访问受限/.test(finished.reason || '') ? 'authentication' : 'cycle_failed', cycle: cycle.id, reason: finished.reason || '任务失败，将自动核对并恢复', nextAt: retry.nextAt });
}
