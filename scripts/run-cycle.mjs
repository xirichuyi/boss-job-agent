import { runWorkflows } from '../src/workflows/cycle-runner.js';
import { ROOT } from '../src/project-root.js';
import { AGENT } from '../src/agent-config.js';
import { createAsyncDecision } from '../src/workflows/async-decision.js';
import { summarizeCycle } from '../src/workflows/summary.js';
import { readState, harness } from '../src/harness-store.js';
import { VisibleTools } from '../src/visible-tools.js';
import { atomicJson, atomicBatch } from '../src/schedule-state.js';
import { MODEL, REASONING_EFFORT } from '../src/model-config.js';
import { cooldown } from '../src/model-budget.js';
import { availableDecision } from '../src/workflows/available-decision.js';

const root = ROOT;
if (!harness()?.owns(process.env.JOB_AGENT_LEASE)) throw Error('禁止绕过Harness直接启动求职执行器');
const cyclePath = root + '/memory/scheduled-cycle.json';
const cycle = readState(cyclePath);
if (cycle.status !== 'running' || !Number.isInteger(cycle.newContactAllocation)) throw new Error('没有运行中的授权周期');
const resultPath = `${root}/memory/cycles/${cycle.id}.json`;
const ledgerPath = root + '/memory/outreach-ledger.json';
const ledger = readState(ledgerPath, { contacts: [] });
const report = { id: cycle.id, startedAt: new Date().toISOString(), status: 'running', model: MODEL, reasoningEffort: REASONING_EFFORT, jobReviews: [], intents: [], receipts: [], result: { newContacts: 0, messagesSent: 0, repliesSent: 0, attachmentsSent: 0 } };
const jobs = new VisibleTools(), chat = new VisibleTools();
let stopped;
function checkRunning() { if(stopped)throw Object.assign(Error('并行分支已停止：'+stopped.message),{code:stopped.code}); }
function assertAuthority() {
  checkRunning();
  if (!harness()?.owns(process.env.JOB_AGENT_LEASE)) throw Object.assign(Error('执行租约失效，禁止继续发送'),{code:'LEASE_LOST'});
  if (!readState(root + '/memory/schedule.json', {}).enabled || Date.parse(readState(root + '/memory/maintenance.json', {}).until || '') > Date.now()) throw Object.assign(Error('任务已暂停或维护，禁止继续发送'),{code:'TASK_PAUSED'});
}
function save() { atomicBatch([[resultPath, report], [ledgerPath, ledger]]); }
function progress(phase, details = {}) {
  save();
  const status = { checkedAt: new Date().toISOString(), state: 'running', cycle: cycle.id, lanes: report.lanes, phase, ...details };
  atomicJson(root + '/memory/scheduler-status.json', status);
  console.log(JSON.stringify(status));
}

const decide = availableDecision(createAsyncDecision({root, cycle, progress, check:checkRunning}),{
  cooldown:()=>cooldown(root),
  onDeferred:state=>{report.modelDeferredUntil=state.until;save();}
});
const context = {root, cycle, ledger, report, jobs, chat, decide, progress, save, assertAuthority};
try {
  if (!harness()) throw Error('Harness未初始化');
  save();
  await runWorkflows(context,{checkRunning,onFailure:(name,error)=>{stopped ||= error;}});
  if(report.contactFailures?.length || report.intents.some(i=>i.status==='outcome_unknown')){
    report.status='blocked';report.reason='CONTACT_RECOVERY_PENDING：个别联系人待恢复，其他分支已正常执行';process.exitCode=1;
  } else report.status = 'completed';
} catch (error) { report.status = 'blocked'; report.reason = error.message; process.exitCode = 1; }
finally {
  // All lanes have settled. Prepared intents never entered the click callback.
  for(const intent of report.intents)if(intent.status==='prepared')intent.status='cancelled';
  jobs.disconnect(); chat.disconnect(); report.summary = summarizeCycle(report); report.completedAt = new Date().toISOString(); save();
  atomicBatch([[resultPath, report], [ledgerPath, ledger], [cyclePath, { ...cycle, status: report.status, result: report.result, summary: report.summary, reason: report.reason, completedAt: report.completedAt }]]);
  atomicJson(root + '/memory/scheduler-status.json', { checkedAt: report.completedAt, state: report.status, cycle: cycle.id, result: report.result, reason: report.reason });
  console.log(JSON.stringify({ status: report.status, result: report.result, reason: report.reason }));
}
