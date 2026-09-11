import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { CODE_ROOT } from "../src/project-root.ts";

// Never inherit a live root, config, lease or permission to send.
const env = { ...process.env };
for (const key of Object.keys(env))
  if (key.startsWith("BOSS_") || key.startsWith("JOB_AGENT_")) delete env[key];
const base = process.argv[2] || os.tmpdir();
const sandbox = fs.mkdtempSync(
  path.join(path.resolve(base), "boss-acceptance-"),
);
const code = path.join(sandbox, "code");
const data = path.join(sandbox, "data");
const config = path.join(sandbox, "config");
fs.mkdirSync(code, { mode: 0o700 });
fs.mkdirSync(data, { mode: 0o700 });
env.BOSS_DATA_DIR = data;
env.BOSS_CONFIG_DIR = config;
const steps: Array<{ name: string; passed: boolean }> = [];
const reportFile = path.join(sandbox, "acceptance.json");
function run(name: string, binary: string, args: string[], expected = 0) {
  const result = spawnSync(binary, args, {
    cwd: code,
    env,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const passed = result.status === expected;
  steps.push({ name, passed });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed)
    throw Error(
      `${name}: ${result.error?.message || result.stderr || result.stdout}`,
    );
  return result.stdout;
}
try {
  for (const name of [
    "README.md",
    "docs",
    "src",
    "scripts",
    "test",
    "config",
    "prompts",
    "examples",
    "deploy",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "tsconfig.core.json",
  ])
    fs.cpSync(path.join(CODE_ROOT, name), path.join(code, name), {
      recursive: true,
      filter: (p) => !p.includes("__pycache__") && !p.includes("/private"),
    });
  // Checks run before assigning private config: fixture tests resolve defaults independently.
  delete env.BOSS_CONFIG_DIR;
  delete env.BOSS_DATA_DIR;
  run("clean dependency installation", "npm", [
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  run("typecheck and regression suite", "npm", ["run", "check"]);
  env.BOSS_DATA_DIR = data;
  env.BOSS_CONFIG_DIR = config;
  run("generate private configuration", process.execPath, [
    "scripts/setup.ts",
    "--answers",
    "examples/setup-answers.json",
    "--output",
    config,
  ]);
  run("initialize disabled ledger", process.execPath, ["scripts/init.ts"]);
  const tick = run("one disabled scheduler tick", process.execPath, [
    "scripts/scheduler.ts",
    "--once",
  ]);
  if (!tick.includes('"state":"disabled"'))
    throw Error("调度器没有确认发送关闭");
  const status = JSON.parse(
    run("read effective configuration", process.execPath, [
      "scripts/agent-status.ts",
    ]),
  );
  if (
    status.schedule.enabled ||
    status.schedule.automationReady ||
    status.configuration.paths.data !== data ||
    fs.existsSync(path.join(code, "memory"))
  )
    throw Error("隔离或默认关闭验收失败");
  run(
    "refuse repeated initialization",
    process.execPath,
    ["scripts/init.ts"],
    1,
  );
  console.log("隔离安装验收通过；未连接浏览器、未调用模型、未发送消息。");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        passed: !process.exitCode,
        code,
        data,
        config,
        steps,
        scope: "offline installation; no real browser/model/send verification",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log("验收目录与报告保留：" + reportFile);
}
