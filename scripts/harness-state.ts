import { ROOT } from "../src/project-root.ts";
import { readState, harness } from "../src/storage/harness.ts";
import { atomicJson, atomicBatch } from "../src/storage/state.ts";
const root = ROOT + "/memory/";
const [action] = process.argv.slice(2);
if (action === "timeout") {
  const cycle = readState(root + "scheduled-cycle.json", {});
  const now = new Date().toISOString(),
    reason = "worker_timeout_result_unconfirmed";
  const status = {
    checkedAt: now,
    state: "blocked",
    cycle: cycle.id || null,
    reason,
  };
  if (!cycle.id) atomicJson(root + "scheduler-status.json", status);
  else
    atomicBatch([
      [
        root + "scheduled-cycle.json",
        { ...cycle, status: "blocked", reason, completedAt: now },
      ],
      [root + "scheduler-status.json", status],
    ]);
} else if (action === "error") {
  atomicJson(root + "scheduler-status.json", {
    state: "error",
    checkedAt: new Date().toISOString(),
    reason: "TypeScript supervisor error; inspect service journal",
  });
} else if (action === "enqueue") {
  if (!harness()) throw Error("Harness未迁移");
  console.log(harness().enqueue("manual"));
} else throw Error("未知操作");
