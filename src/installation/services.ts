import fs from "node:fs";
import path from "node:path";
import { CODE_ROOT } from "../project-root.ts";
import { writePrivate } from "./workspace.ts";

export function renderServices(state, node = process.execPath) {
  if (!/^[a-z_][a-z0-9_-]*[$]?$/.test(state.user) || state.user === "root")
    throw Error("服务必须使用非 root 用户；请以最终服务用户创建工作区");
  for (const value of [
    CODE_ROOT,
    node,
    state.config,
    state.data,
    state.desktop,
    state.browserData,
    state.codexHome || "",
  ])
    if (/[\r\n"\\%]/.test(value))
      throw Error("systemd路径不支持换行、引号、反斜杠或百分号");
  const env =
    `Environment="BOSS_CONFIG_DIR=${state.config}"\nEnvironment="BOSS_DATA_DIR=${state.data}"\nEnvironment="NODE_BINARY=${node}"\nEnvironment="PATH=${path.dirname(node)}:/usr/local/bin:/usr/bin:/bin"` +
    (state.codexHome ? `\nEnvironment="CODEX_HOME=${state.codexHome}"` : "");
  const scheduler = `[Unit]\nDescription=Job agent scheduler\nAfter=network-online.target\n[Service]\nType=simple\nUser=${state.user}\nWorkingDirectory="${CODE_ROOT}"\n${env}\nExecStart="${node}" "${CODE_ROOT}/scripts/scheduler.ts"\nRestart=always\nRestartSec=15\nKillMode=control-group\nTimeoutStopSec=45\nUMask=0077\n[Install]\nWantedBy=multi-user.target\n`;
  const desktop = fs
    .readFileSync(
      path.join(CODE_ROOT, "deploy/job-agent-desktop.service"),
      "utf8",
    )
    .replaceAll("@ROOT@", CODE_ROOT.replace(/\/$/, ""))
    .replaceAll("@USER@", state.user)
    .replaceAll("@NODE@", node)
    .replaceAll("@DESKTOP_CONFIG@", state.desktop)
    .replaceAll("@BROWSER_DATA@", state.browserData);
  return {
    "job-agent-scheduler.service": scheduler,
    "job-agent-desktop.service": desktop,
  };
}
export function writeServices(state) {
  const output = path.join(state.root, "units");
  const entries = Object.entries(renderServices(state));
  for (const [file, value] of entries)
    if (
      fs.existsSync(path.join(output, file)) &&
      fs.readFileSync(path.join(output, file), "utf8") !== value
    )
      throw Error("服务模板已被修改，拒绝覆盖：" + file);
  for (const [file, value] of entries)
    if (!fs.existsSync(path.join(output, file)))
      writePrivate(path.join(output, file), value);
  return output;
}
