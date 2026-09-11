import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { runProcessGroup } from "../src/runtime/process-supervisor.ts";
import {
  writeDiagnostic,
  supervisorConfig,
  schedulerTick,
} from "../src/runtime/scheduler.ts";
const base = { cwd: process.cwd(), timeoutMs: 2000, graceMs: 30 };
test("supervisor returns success and failure codes", async () => {
  assert.equal(
    await runProcessGroup(process.execPath, ["-e", "process.exit(0)"], base),
    0,
  );
  assert.equal(
    await runProcessGroup(process.execPath, ["-e", "process.exit(7)"], base),
    7,
  );
});
test("supervisor escalates a child ignoring TERM and returns timeout", async () => {
  const code = await runProcessGroup(
    process.execPath,
    ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    { ...base, timeoutMs: 200 },
  );
  assert.equal(code, 124);
});
test("supervisor cancellation terminates its process group", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    assert.equal(
      await runProcessGroup(
        process.execPath,
        ["-e", "setInterval(()=>{},1000)"],
        { ...base, signal: controller.signal },
      ),
      130,
    );
  } finally {
    clearTimeout(timer);
  }
});
test("timeout kills a TERM-ignoring grandchild even after its parent exits", async (t) => {
  const root = fs.mkdtempSync(os.tmpdir() + "/boss-grandchild-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pidFile = root + "/pid";
  const script = `const {spawn}=require('child_process');const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000);`;
  assert.equal(
    await runProcessGroup(process.execPath, ["-e", script], {
      ...base,
      timeoutMs: 500,
      graceMs: 100,
    }),
    124,
  );
  const pid = Number(fs.readFileSync(pidFile, "utf8"));
  let state = "";
  // SIGKILL delivery and /proc state publication are asynchronous kernel operations.
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      state = fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1][0];
    } catch (error) {
      assert.equal(error.code, "ENOENT");
      state = "";
    }
    if (state === "" || state === "Z") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(
    state === "" || state === "Z",
    "grandchild must be dead, not running",
  );
});
test("diagnostic writes remain private and lock contention skips dispatcher", async (t) => {
  const root = fs.mkdtempSync(os.tmpdir() + "/boss-supervisor-");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(root + "/memory");
  writeDiagnostic(root + "/memory/state.json", { state: "waiting" });
  assert.equal(fs.statSync(root + "/memory/state.json").mode & 0o777, 0o600);
  const lock = root + "/memory/scheduler.lock";
  const ready = root + "/ready";
  const holding = runProcessGroup(
    "/usr/bin/flock",
    [
      lock,
      process.execPath,
      "-e",
      `require('fs').writeFileSync(${JSON.stringify(ready)},'ready');setTimeout(()=>{},500)`,
    ],
    base,
  );
  for (let i = 0; i < 100 && !fs.existsSync(ready); i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.ok(fs.existsSync(ready));
  assert.equal(
    await schedulerTick(root, supervisorConfig(), true),
    "already_running",
  );
  await holding;
});
