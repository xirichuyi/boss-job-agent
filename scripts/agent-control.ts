import { ROOT } from "../src/project-root.ts";
import { readState, harness } from "../src/storage/harness.ts";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { atomicJson } from "../src/storage/state.ts";
const root = ROOT + "/memory/";
const action = process.argv[2];
const config = readState(root + "schedule.json");
if (!["pause", "resume", "maintenance"].includes(action))
  throw Error("用法：agent-control.ts pause|resume|maintenance [分钟，1-120]");
if (!config) throw Error("请先初始化项目；未修改任何服务");
if (action === "maintenance") {
  const minutes = Number(process.argv[3]);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120)
    throw Error("维护必须有1-120分钟的明确到期时间");
  atomicJson(root + "maintenance.json", {
    until: new Date(Date.now() + minutes * 60000).toISOString(),
  });
} else {
  config.enabled = action === "resume";
  atomicJson(root + "schedule.json", config);
  atomicJson(root + "maintenance.json", { until: null });
}
if (action === "resume" && !process.argv.includes("--state-only")) {
  const result = spawnSync(
    "/usr/bin/systemctl",
    ["start", "job-agent-scheduler.service"],
    { stdio: "inherit", timeout: 25000 },
  );
  if (result.status !== 0) {
    console.error(
      "运行授权已恢复，但启动服务失败；检查 unit 权限，或使用 --state-only 配合前台调度器",
    );
    process.exitCode = 1;
  }
}
console.log(
  action === "maintenance"
    ? "已进入维护：禁止新发送，不强杀在途回执；到期后自动继续"
    : action === "pause"
      ? "已暂停新任务及新发送；在途回执继续确认，不强杀服务"
      : "已恢复运行授权",
);
