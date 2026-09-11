import { spawn } from "node:child_process";

export interface ProcessOptions {
  cwd: string;
  timeoutMs: number;
  graceMs: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}
/** The detached process group contains flock, dispatcher, model workers and their children. */
export function runProcessGroup(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<number> {
  if (options.signal?.aborted) return Promise.resolve(130);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", "inherit", "inherit"],
    });
    let stopping = false,
      closed = false,
      exitCode = 1,
      finished = false,
      escalated = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      if (child.pid)
        try {
          process.kill(-child.pid, signal);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
        }
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (grace) clearTimeout(grace);
      options.signal?.removeEventListener("abort", abort);
      resolve(exitCode);
    };
    const stop = (code: number) => {
      if (stopping || finished) return;
      stopping = true;
      exitCode = code;
      kill("SIGTERM");
      // Do not cancel this when the parent exits: grandchildren may ignore SIGTERM.
      grace = setTimeout(() => {
        escalated = true;
        kill("SIGKILL");
        if (closed) finish();
      }, options.graceMs);
    };
    const abort = () => stop(130);
    const timeout = setTimeout(() => stop(124), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (grace) clearTimeout(grace);
      options.signal?.removeEventListener("abort", abort);
      finished = true;
      reject(error);
    });
    child.on("close", (code) => {
      closed = true;
      if (!stopping) {
        exitCode = code ?? 1;
        finish();
      } else if (escalated) finish();
    });
  });
}
