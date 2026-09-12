import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { CODE_ROOT } from "../project-root.ts";
import { resolveExecutable } from "../config/executable.ts";

export function writePrivate(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + "." + randomUUID() + ".tmp";
  fs.writeFileSync(
    tmp,
    typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  fs.renameSync(tmp, file);
}
export function workspace(directory: string, create = false) {
  const root = path.resolve(directory),
    file = path.join(root, "installation.json");
  if (!fs.existsSync(file)) {
    if (!create) throw Error("安装工作区不存在；先执行 init");
    if (fs.existsSync(root) && fs.readdirSync(root).length)
      throw Error("拒绝接管非空目录；已有安装请走升级流程");
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    writePrivate(file, {
      version: 1,
      root,
      user: os.userInfo().username,
      uid: process.getuid?.(),
      codexHome: process.env.CODEX_HOME || null,
      config: path.join(root, "config"),
      data: path.join(root, "data"),
      desktop: path.join(root, "desktop.json"),
      browserData: path.join(root, "browser"),
      checks: {},
      createdAt: new Date().toISOString(),
    });
  }
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    state.version !== 1 ||
    state.root !== root ||
    state.uid !== process.getuid?.()
  )
    throw Error(
      "工作区位置/运行用户不匹配；请使用创建工作区的服务用户，禁止自动迁移凭据",
    );
  for (const [key, relative] of Object.entries({
    config: "config",
    data: "data",
    desktop: "desktop.json",
    browserData: "browser",
  }))
    if (state[key] !== path.join(root, relative))
      throw Error("安装目录绑定已改变");
  return { state, save: () => writePrivate(file, state) };
}
export function configOf(state) {
  return Object.fromEntries(
    ["agent", "model", "execution", "job-filters"].map((k) => [
      k,
      JSON.parse(fs.readFileSync(path.join(state.config, k + ".json"), "utf8")),
    ]),
  );
}
export function fingerprint(state, agentOverride?: unknown) {
  const hash = createHash("sha256");
  for (const file of ["agent", "model", "execution", "job-filters"]
    .map((k) => path.join(state.config, k + ".json"))
    .concat(path.join(state.data, "candidate-profile.md"), state.desktop))
    hash
      .update(file)
      .update(
        agentOverride !== undefined &&
          file === path.join(state.config, "agent.json")
          ? JSON.stringify(agentOverride, null, 2) + "\n"
          : fs.existsSync(file)
            ? fs.readFileSync(file)
            : "missing",
      );
  return hash.digest("hex");
}
function checkFingerprint(state, name: string) {
  if (name === "browser") {
    const desktop = JSON.parse(fs.readFileSync(state.desktop, "utf8"));
    const normalize = ({ binary, cdpUrl, vncPort, webPort }) => ({
      binary,
      cdpUrl,
      vncPort,
      webPort,
    });
    let configured = desktop;
    try {
      configured = configOf(state).agent.browser;
    } catch {}
    return createHash("sha256")
      .update(JSON.stringify([normalize(desktop), normalize(configured)]))
      .digest("hex");
  }
  if (["model", "browser", "attachment"].includes(name)) {
    try {
      const files = configOf(state);
      const value =
        name === "model"
          ? { model: files.model, codex: files.agent.codex }
          : {
              desktop: JSON.parse(fs.readFileSync(state.desktop, "utf8")),
              browser: files.agent.browser,
              ...(name === "attachment"
                ? { filename: files.agent.resumeFile }
                : {}),
            };
      return createHash("sha256").update(JSON.stringify(value)).digest("hex");
    } catch {
      return "missing";
    }
  }
  return fingerprint(state);
}
export function evidence(state, name: string, detail: unknown) {
  state.checks[name] = {
    at: new Date().toISOString(),
    fingerprint: checkFingerprint(state, name),
    uid: state.uid,
    detail,
  };
}
export function verified(state, name: string) {
  return (
    state.checks[name]?.fingerprint === checkFingerprint(state, name) &&
    state.checks[name]?.uid === state.uid
  );
}
export function databaseValue(state, key: string, fallback: any = null) {
  const file = path.join(state.data, "memory/harness.sqlite");
  if (!fs.existsSync(file)) return fallback;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("select value from documents where key=?").get(key);
    return row ? JSON.parse(String(row.value)) : fallback;
  } finally {
    db.close();
  }
}
export function requireIdle(state) {
  const file = path.join(state.data, "memory/harness.sqlite");
  if (!fs.existsSync(file)) return;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (
      databaseValue(state, "schedule.json", {}).enabled ||
      databaseValue(state, "scheduled-cycle.json", {}).status === "running" ||
      db.prepare("select * from lease").all().length
    )
      throw Error("请先 pause 并等待在途任务结束；不能改动运行中的配置");
  } finally {
    db.close();
  }
}
export function runtimeEnv(state): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BOSS_CONFIG_DIR: state.config,
    BOSS_DATA_DIR: state.data,
    BOSS_DESKTOP_CONFIG: state.desktop,
    BOSS_RPA_DATA_DIR: state.browserData,
    NODE_BINARY: process.execPath,
  };
  delete env.BOSS_AGENT_CONFIG;
  delete env.BOSS_JOB_FILTERS_CONFIG;
  delete env.BOSS_AGENT_ROOT;
  if (state.codexHome) env.CODEX_HOME = state.codexHome;
  else delete env.CODEX_HOME;
  return env;
}
export function initialDesktop(state) {
  if (!fs.existsSync(state.desktop)) {
    const defaults = JSON.parse(
      fs.readFileSync(path.join(CODE_ROOT, "config/agent.json"), "utf8"),
    ).browser;
    defaults.binary = resolveExecutable(defaults.binary);
    writePrivate(state.desktop, defaults);
  }
}

export function installationLock(state) {
  const file = path.join(state.root, "installation.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });
      return () => {
        if (fs.readFileSync(file, "utf8") === String(process.pid))
          fs.unlinkSync(file);
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(fs.readFileSync(file, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw Error("安装锁损坏，请人工核对");
      try {
        process.kill(pid, 0);
        throw Error("另一个安装操作正在运行；使用 status 查看进度");
      } catch (check) {
        if (check.code !== "ESRCH") throw check;
      }
      fs.unlinkSync(file); // Only a lock whose recorded process no longer exists.
    }
  }
  throw Error("无法取得安装锁，请重试");
}
