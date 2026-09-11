import { parentPort, workerData } from "node:worker_threads";
import { createDecision } from "./decision.ts";

try {
  const { root, cycle, mode, args } = workerData;
  const decide = createDecision({
    root,
    cycle,
    progress: (phase, details) =>
      parentPort.postMessage({ type: "progress", phase, details }),
  });
  const result =
    mode === "batch"
      ? decide.batch(args[0])
      : decide(args[0], args[1], args[2]);
  parentPort.postMessage({ type: "result", result });
} catch (error) {
  parentPort.postMessage({
    type: "failure",
    message: error.message,
    code: error.code,
    until: error.until,
  });
} finally {
  parentPort.close();
}
