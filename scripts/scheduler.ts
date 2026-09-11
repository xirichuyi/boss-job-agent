import { ROOT, CODE_ROOT } from "../src/project-root.ts";
import { executionConfig } from "../src/runtime/coordinator.ts";
import { runScheduler, supervisorConfig } from "../src/runtime/scheduler.ts";
if (process.argv.slice(2).some((arg) => arg !== "--once"))
  throw Error("用法：node scripts/scheduler.ts [--once]");
const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => controller.abort());
process.exitCode = await runScheduler(
  ROOT,
  supervisorConfig(executionConfig().supervisor),
  process.argv.includes("--once"),
  controller.signal,
  CODE_ROOT,
);
