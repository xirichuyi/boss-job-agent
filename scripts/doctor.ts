import { ROOT } from "../src/project-root.ts";
import { diagnose } from "../src/runtime/doctor.ts";
let result;
try {
  const { effectiveConfig } = await import("../src/config/effective.ts");
  result = await diagnose({
    root: ROOT,
    config: effectiveConfig(),
    offline: process.argv.includes("--offline"),
  });
} catch (error) {
  result = {
    ok: false,
    checks: [
      {
        name: "configuration",
        status: "error",
        detail:
          error instanceof SyntaxError ? "配置 JSON 格式错误" : error.message,
        fix: "检查 BOSS_CONFIG_DIR 指定目录中的四份配置，或旧的单文件环境变量",
      },
    ],
  };
}
if (process.argv.includes("--json"))
  console.log(JSON.stringify(result, null, 2));
else
  for (const c of result.checks)
    console.log(
      "[" +
        c.status +
        "] " +
        c.name +
        ": " +
        c.detail +
        (c.fix ? "\n  建议：" + c.fix : ""),
    );
process.exitCode = result.ok ? 0 : 1;
