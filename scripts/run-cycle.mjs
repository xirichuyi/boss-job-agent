import { ROOT } from '../src/project-root.js';
import { AGENT } from '../src/agent-config.js';
import { createDecision } from '../src/workflows/decision.js';
import { checkInbox } from '../src/workflows/inbox.js';
import { reconcileUnknown } from '../src/workflows/reconcile.js';
import { searchJobs, nextSearchPage } from '../src/workflows/search.js';
import { contactJobs } from '../src/workflows/outreach.js';
import { summarizeCycle } from '../src/workflows/summary.js';
import { readState, harness } from '../src/harness-store.js';
import { VisibleTools } from '../src/visible-tools.js';
import { atomicJson, atomicBatch } from '../src/schedule-state.js';
import { classifyFailure } from '../src/autonomy.js';
import { MODEL, REASONING_EFFORT } from '../src/model-config.js';

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
function assertAuthority() {
  if (!harness()?.owns(process.env.JOB_AGENT_LEASE)) throw Error('执行租约失效，禁止继续发送');
  if (!readState(root + '/memory/schedule.json', {}).enabled || Date.parse(readState(root + '/memory/maintenance.json', {}).until || '') > Date.now()) throw Error('任务已暂停或维护，禁止继续发送');
}
function save() { atomicBatch([[resultPath, report], [ledgerPath, ledger]]); }
function progress(phase, details = {}) {
  save();
  const status = { checkedAt: new Date().toISOString(), state: 'running', cycle: cycle.id, phase, ...details };
  atomicJson(root + '/memory/scheduler-status.json', status);
  console.log(JSON.stringify(status));
}

const decide = createDecision({root, cycle, progress});
const context = {root, cycle, ledger, report, jobs, chat, decide, progress, save, assertAuthority};
try {
  if (!harness()) throw Error('Harness未初始化');
  save();
  await jobs.connectView('jobs');
  await chat.connectView('chat');
  try {
    const searchDeadline = Date.now() + AGENT.workflow.searchMinutes * 60000;
    for (let batch = 0; batch < AGENT.workflow.searchBatches && Date.now() < searchDeadline; batch++) {
      let list = await searchJobs(context);
      for (let page = 1; page <= AGENT.workflow.searchPages && list.length; page++) {
        await contactJobs({ ...context, list, deadline: searchDeadline });
        if (report.result.newContacts >= cycle.newContactAllocation || Date.now() >= searchDeadline || page === AGENT.workflow.searchPages) break;
        list = await nextSearchPage(context, page + 1);
      }
      if (report.result.newContacts >= cycle.newContactAllocation) break;
    }
  } catch (error) {
    if (error.code === 'MODEL_COOLDOWN') throw error;
    if (classifyFailure(error.message) !== 'transient' || report.intents.some(i => !['delivered', 'platform_greeting_delivered'].includes(i.status))) throw error;
    report.searchWarning = error.message; save(); // Read-only search failure must not starve replies.
  }
  const replyDeadline = Date.now() + AGENT.workflow.replyMinutes * 60000;
  await reconcileUnknown({ ...context, deadline: replyDeadline });
  await checkInbox({ ...context, deadline: replyDeadline });
  report.status = 'completed';
} catch (error) { report.status = 'blocked'; report.reason = error.message; process.exitCode = 1; }
finally {
  jobs.disconnect(); chat.disconnect(); report.summary = summarizeCycle(report); report.completedAt = new Date().toISOString(); save();
  atomicBatch([[resultPath, report], [ledgerPath, ledger], [cyclePath, { ...cycle, status: report.status, result: report.result, summary: report.summary, reason: report.reason, completedAt: report.completedAt }]]);
  atomicJson(root + '/memory/scheduler-status.json', { checkedAt: report.completedAt, state: report.status, cycle: cycle.id, result: report.result, reason: report.reason });
  console.log(JSON.stringify({ status: report.status, result: report.result, reason: report.reason }));
}
