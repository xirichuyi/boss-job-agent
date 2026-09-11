import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { runProcessGroup } from "./process-supervisor.ts";

export interface SupervisorConfig {
  pollMs: number;
  workerTimeoutMs: number;
  terminationGraceMs: number;
  stateTimeoutMs: number;
  notificationTimeoutMs: number;
}
export function supervisorConfig(
  value: Partial<SupervisorConfig> = {},
): SupervisorConfig {
  const config = {
    pollMs: 60000,
    workerTimeoutMs: 900000,
    terminationGraceMs: 10000,
    stateTimeoutMs: 15000,
    notificationTimeoutMs: 75000,
    ...value,
  };
  if (
    !Object.values(config).every((v) => Number.isSafeInteger(v) && v > 0) ||
    config.workerTimeoutMs > 900000 ||
    config.terminationGraceMs > 30000
  )
    throw Error("监督器配置无效");
  return config;
}
export function writeDiagnostic(file: string, value: unknown): void {
  const temporary = path.join(
    path.dirname(file),
    "." + path.basename(file) + "." + randomUUID(),
  );
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, file);
}
export async function schedulerTick(
  root: string,
  config: SupervisorConfig,
  force = false,
  signal?: AbortSignal,
  codeRoot = root,
): Promise<number | "already_running"> {
  const env: NodeJS.ProcessEnv = { ...process.env, BOSS_DATA_DIR: root };
  delete env.JOB_AGENT_FORCE;
  if (force) env.JOB_AGENT_FORCE = "1";
  const options = {
    cwd: root,
    env,
    signal,
    graceMs: config.terminationGraceMs,
  };
  const code = await runProcessGroup(
    "/usr/bin/flock",
    [
      "-n",
      "-E",
      "73",
      path.join(root, "memory/scheduler.lock"),
      process.execPath,
      path.join(codeRoot, "scripts/scheduled-agent.ts"),
    ],
    { ...options, timeoutMs: config.workerTimeoutMs },
  );
  if (code === 73) return "already_running";
  if (code === 130) return code;
  if (code === 124) {
    const committed = await runProcessGroup(
      process.execPath,
      [path.join(codeRoot, "scripts/harness-state.ts"), "timeout"],
      { ...options, timeoutMs: config.stateTimeoutMs },
    );
    if (committed !== 0) throw Error("超时状态提交失败");
  }
  await runProcessGroup(
    process.execPath,
    [path.join(codeRoot, "scripts/telegram-notify.ts")],
    { ...options, timeoutMs: config.notificationTimeoutMs },
  );
  return code;
}
export async function runScheduler(
  root: string,
  config: SupervisorConfig,
  once = false,
  signal?: AbortSignal,
  codeRoot = root,
): Promise<number> {
  process.umask(0o077);
  while (!signal?.aborted) {
    const started = Date.now();
    let result: number | "already_running" = 1;
    try {
      result = await schedulerTick(root, config, once, signal, codeRoot);
    } catch (error) {
      console.error(
        "调度错误：" + (error instanceof Error ? error.message : String(error)),
      );
      if (!signal?.aborted)
        try {
          await runProcessGroup(
            process.execPath,
            [path.join(codeRoot, "scripts/harness-state.ts"), "error"],
            {
              cwd: root,
              env: { ...process.env, BOSS_DATA_DIR: root },
              timeoutMs: config.stateTimeoutMs,
              graceMs: config.terminationGraceMs,
              signal,
            },
          );
        } catch (stateError) {
          console.error("状态错误记录失败：" + String(stateError));
        }
      writeDiagnostic(path.join(root, "memory/scheduler-health-error.json"), {
        checkedAt: new Date().toISOString(),
        state: "error",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    console.log(
      JSON.stringify({ at: new Date().toISOString(), tickResult: result }),
    );
    if (once) return result === 0 || result === "already_running" ? 0 : 1;
    writeDiagnostic(path.join(root, "memory/scheduler-heartbeat.json"), {
      at: new Date().toISOString(),
      pid: process.pid,
    });
    if (signal?.aborted) break;
    try {
      await delay(
        Math.max(1, config.pollMs - (Date.now() - started)),
        undefined,
        { signal },
      );
    } catch (error) {
      if (!signal?.aborted) throw error;
    }
  }
  return 0;
}
