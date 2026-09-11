import { runWorkflows } from "../src/application/cycle-runner.ts";
import { ROOT } from "../src/project-root.ts";
import { AGENT } from "../src/config/agent.ts";
import { createAsyncDecision } from "../src/application/async-decision.ts";
import { summarizeCycle } from "../src/application/summary.ts";
import { readState, harness } from "../src/storage/harness.ts";
import { VisibleTools } from "../src/adapters/browser/visible.ts";
import { atomicJson, atomicBatch } from "../src/storage/state.ts";
import { MODEL, REASONING_EFFORT } from "../src/config/model.ts";
import { cooldown } from "../src/adapters/model/budget.ts";
import { availableDecision } from "../src/application/available-decision.ts";

const root = ROOT;
if (!harness()?.owns(process.env.JOB_AGENT_LEASE))
  throw Error("禁止绕过Harness直接启动求职执行器");
const cyclePath = root + "/memory/scheduled-cycle.json";
const cycle = readState(cyclePath);
if (cycle.status !== "running" || !Number.isInteger(cycle.newContactAllocation))
  throw new Error("没有运行中的授权周期");
const resultPath = `${root}/memory/cycles/${cycle.id}.json`;
const ledgerPath = root + "/memory/outreach-ledger.json";
const ledger = readState(ledgerPath, { contacts: [] });
const report: CycleReport = {
  id: cycle.id,
  startedAt: new Date().toISOString(),
  status: "running",
  model: MODEL,
  reasoningEffort: REASONING_EFFORT,
  jobReviews: [],
  intents: [],
  receipts: [],
  result: {
    newContacts: 0,
    messagesSent: 0,
    repliesSent: 0,
    attachmentsSent: 0,
  },
};
const jobs = new VisibleTools(),
  chat = new VisibleTools();
let stopped;
function checkRunning() {
  if (stopped)
    throw Object.assign(Error("并行分支已停止：" + stopped.message), {
      code: stopped.code,
    });
}
function assertAuthority() {
  checkRunning();
  if (!harness()?.owns(process.env.JOB_AGENT_LEASE))
    throw Object.assign(Error("执行租约失效，禁止继续发送"), {
      code: "LEASE_LOST",
    });
  if (
    !readState(root + "/memory/schedule.json", {}).enabled ||
    Date.parse(readState(root + "/memory/maintenance.json", {}).until || "") >
      Date.now()
  )
    throw Object.assign(Error("任务已暂停或维护，禁止继续发送"), {
      code: "TASK_PAUSED",
    });
}
function save() {
  atomicBatch([
    [resultPath, report],
    [ledgerPath, ledger],
  ]);
}
function progress(phase, details = {}) {
  save();
  const status = {
    checkedAt: new Date().toISOString(),
    state: "running",
    cycle: cycle.id,
    lanes: report.lanes,
    phase,
    ...details,
  };
  atomicJson(root + "/memory/scheduler-status.json", status);
  console.log(JSON.stringify(status));
}

const decide = availableDecision(
  createAsyncDecision({ root, cycle, progress, check: checkRunning }),
  {
    cooldown: () => cooldown(root),
    onDeferred: (state) => {
      report.modelDeferredUntil = state.until;
      save();
    },
  },
);
const context = {
  root,
  cycle,
  ledger,
  report,
  jobs,
  chat,
  decide,
  progress,
  save,
  assertAuthority,
};
try {
  if (!harness()) throw Error("Harness未初始化");
  save();
  await runWorkflows(context, {
    checkRunning,
    onFailure: (name, error) => {
      stopped ||= error;
    },
  });
  if (
    report.contactFailures?.length ||
    report.intents.some((i) => i.status === "outcome_unknown")
  ) {
    report.status = "blocked";
    report.reason =
      "CONTACT_RECOVERY_PENDING：个别联系人待恢复，其他分支已正常执行";
    process.exitCode = 1;
  } else report.status = "completed";
} catch (error) {
  report.status = "blocked";
  report.reason = error.message;
  process.exitCode = 1;
} finally {
  // All lanes have settled. Prepared intents never entered the click callback.
  for (const intent of report.intents)
    if (intent.status === "prepared") intent.status = "cancelled";
  jobs.disconnect();
  chat.disconnect();
  report.summary = summarizeCycle(report);
  report.completedAt = new Date().toISOString();
  save();
  atomicBatch([
    [resultPath, report],
    [ledgerPath, ledger],
    [
      cyclePath,
      {
        ...cycle,
        status: report.status,
        result: report.result,
        summary: report.summary,
        reason: report.reason,
        completedAt: report.completedAt,
      },
    ],
  ]);
  atomicJson(root + "/memory/scheduler-status.json", {
    checkedAt: report.completedAt,
    state: report.status,
    cycle: cycle.id,
    result: report.result,
    reason: report.reason,
  });
  console.log(
    JSON.stringify({
      status: report.status,
      result: report.result,
      reason: report.reason,
    }),
  );
}
import type { CycleReport } from "../src/domain/contracts.ts";
