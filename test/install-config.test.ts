import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
const root = fileURLToPath(new URL("..", import.meta.url));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-install-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test("clean install is disabled, repeat init cannot overwrite, disabled tick needs no browser", (t) => {
  const dir = fixture(t),
    env = { ...process.env, BOSS_AGENT_ROOT: dir };
  const run = (script) =>
    spawnSync(process.execPath, [path.join(root, "scripts", script)], {
      env,
      encoding: "utf8",
    });
  assert.equal(run("init.ts").status, 0);
  assert.notEqual(run("init.ts").status, 0);
  const db = new DatabaseSync(path.join(dir, "memory/harness.sqlite"));
  const config = JSON.parse(
    db.prepare("SELECT value FROM documents WHERE key='schedule.json'").get()
      .value,
  );
  assert.equal(config.enabled, false);
  assert.equal(config.automationReady, false);
  assert.ok(!("intervalMinutes" in config));
  db.close();
  const tick = run("scheduled-agent.ts");
  assert.equal(tick.status, 0, tick.stderr);
  assert.match(tick.stdout, /disabled/);
  assert.notEqual(run("enable.ts").status, 0);
  assert.equal(run("harness-state.ts").status, 1);
  const timeout = spawnSync(
    process.execPath,
    [path.join(root, "scripts/harness-state.ts"), "timeout"],
    { env, encoding: "utf8" },
  );
  assert.equal(timeout.status, 0, timeout.stderr);
  const after = new DatabaseSync(path.join(dir, "memory/harness.sqlite"));
  const status = JSON.parse(
    after
      .prepare("SELECT value FROM documents WHERE key='scheduler-status.json'")
      .get().value,
  );
  assert.equal(status.state, "blocked");
  after.close();
});
test("nondefault config controls prompts, policy, resume and model executable", (t) => {
  const dir = fixture(t),
    file = path.join(dir, "agent.json");
  const config = JSON.parse(
    fs.readFileSync(path.join(root, "config/agent.json")),
  );
  config.search.city = "上海";
  config.search.cityCode = "101020100";
  config.resumeFile = "custom.pdf";
  config.codex.binary = "/test/custom-codex";
  fs.writeFileSync(file, JSON.stringify(config));
  const filtersFile = path.join(dir, "job-filters.json");
  const filters = JSON.parse(
    fs.readFileSync(path.join(root, "config/job-filters.json")),
  );
  filters.cities = [{ name: "上海", code: "101020100" }];
  fs.writeFileSync(filtersFile, JSON.stringify(filters));
  const program = `
    import { AGENT } from './src/config/agent.ts';
    import { hardReject } from './src/domain/policy.ts';
    import { buildPrompt } from './src/adapters/model/prompts.ts';
    import { RESUME_FILE } from './src/application/conversation-policy.ts';
    import { callCodex, MODEL } from './src/adapters/model/codex.ts';
    const bin=callCodex(['-m',MODEL,'read-only'],{},bin=>bin);
    console.log(JSON.stringify({ city:AGENT.search.city, rejected:hardReject({location:'杭州',scaleEvidence:'yes'}), resume:RESUME_FILE, bin, prompt:buildPrompt('contact',{}).text }));`;
  const r = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", program],
    {
      cwd: root,
      env: {
        ...process.env,
        BOSS_AGENT_CONFIG: file,
        BOSS_JOB_FILTERS_CONFIG: filtersFile,
      },
      encoding: "utf8",
    },
  );
  assert.equal(r.status, 0, r.stderr);
  const value = JSON.parse(r.stdout);
  assert.equal(value.city, "上海");
  assert.ok(value.rejected);
  assert.equal(value.resume, "custom.pdf");
  assert.equal(value.bin, "/test/custom-codex");
  assert.match(value.prompt, /101020100/);
  config.schedule.perRun = -1;
  fs.writeFileSync(file, JSON.stringify(config));
  assert.notEqual(
    spawnSync(process.execPath, ["--input-type=module", "-e", program], {
      cwd: root,
      env: { ...process.env, BOSS_AGENT_CONFIG: file },
    }).status,
    0,
  );
});
