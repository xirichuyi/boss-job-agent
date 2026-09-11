import { AGENT } from "../../config/agent.ts";
import { spawnSync } from "node:child_process";
import { checkBudget, recordUsage } from "./budget.ts";
import { MODEL, REASONING_EFFORT } from "../../config/model.ts";
export { MODEL, REASONING_EFFORT };
export function callCodex(args, options, runner = spawnSync) {
  const index = args.indexOf("-m");
  if (index < 0 || args[index + 1] !== MODEL)
    throw Error("Harness模型必须为" + MODEL);
  if (
    !args.includes("read-only") ||
    args.includes("--dangerously-bypass-approvals-and-sandbox")
  )
    throw Error("Codex决策不得绕过只读边界");
  const { budgetRoot, usageLog, ...spawnOptions } = options;
  if (budgetRoot) checkBudget(budgetRoot);
  const effectiveArgs = [
    "-c",
    `model_reasoning_effort="${REASONING_EFFORT}"`,
    ...args,
  ];
  if (args.some((arg) => arg.startsWith("model_reasoning_effort")))
    throw Error("推理强度必须由统一配置管理");
  const result = runner(AGENT.codex.binary, effectiveArgs, {
    ...spawnOptions,
    timeout: AGENT.codex.timeoutMs,
  });
  if (budgetRoot) recordUsage(budgetRoot, usageLog);
  return result;
}
