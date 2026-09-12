import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { planSetup } from "../src/config/setup.ts";

test("one-command onboarding uses private paths and never authorizes or overwrites", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-onboard-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const code = fileURLToPath(new URL("..", import.meta.url));
  const config = path.join(root, "my config"),
    data = path.join(root, "my data");
  const answers = path.join(root, "answers.json"),
    profile = path.join(root, "resume.md");
  fs.writeFileSync(
    answers,
    JSON.stringify({
      browserBinary: "/custom/chrome",
      codexBinary: "/custom/codex",
    }),
  );
  fs.writeFileSync(profile, "本人 Go 项目经历");
  const run = (extra = []) =>
    spawnSync(
      process.execPath,
      [
        path.join(code, "scripts/onboard.ts"),
        "--answers",
        answers,
        "--profile",
        profile,
        "--config",
        config,
        "--data",
        data,
        ...extra,
      ],
      {
        env: { ...process.env, BOSS_AGENT_CONFIG: "/invalid/inherited/config" },
        encoding: "utf8",
        timeout: 30000,
      },
    );
  assert.notEqual(run(["--typo", "x"]).status, 0);
  assert.equal(fs.existsSync(config), false);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.statSync(data).mode & 0o777, 0o700);
  assert.equal(
    fs.statSync(path.join(data, "candidate-profile.md")).mode & 0o777,
    0o600,
  );
  const agent = JSON.parse(
    fs.readFileSync(path.join(config, "agent.json"), "utf8"),
  );
  assert.equal(agent.browser.binary, "/custom/chrome");
  assert.equal(agent.codex.binary, "/custom/codex");
  assert.equal(agent.schedule.perRun, 1);
  const db = new DatabaseSync(path.join(data, "memory/harness.sqlite"), {
    readOnly: true,
  });
  const schedule = JSON.parse(
    db.prepare("select value from documents where key='schedule.json'").get()
      .value as string,
  );
  assert.equal(schedule.enabled, false);
  assert.equal(schedule.automationReady, false);
  db.close();
  const before = fs.readFileSync(path.join(data, "memory/harness.sqlite"));
  assert.notEqual(run().status, 0);
  assert.deepEqual(
    fs.readFileSync(path.join(data, "memory/harness.sqlite")),
    before,
  );
  assert.equal(
    fs.readFileSync(path.join(data, "candidate-profile.md"), "utf8"),
    "本人 Go 项目经历",
  );
});

test("portable executable paths are validated in setup", () => {
  for (const binary of ["relative/chrome", "", "/path\nchrome", 123])
    assert.throws(() => planSetup({ browserBinary: binary }), /绝对路径/);
});

test("setup accepts explicit cities outside the bundled examples without guessing codes", () => {
  const cities = [{ name: "上海", code: "101020100" }, "深圳"];
  const files = planSetup({ cities });
  assert.deepEqual(files["job-filters"].cities[0], cities[0]);
  assert.equal(files["job-filters"].cities[1].name, "深圳");
  for (const invalid of [
    [{ name: "上海", code: "guess" }],
    ["unknown"],
    ["深圳", "深圳"],
    [{}],
  ])
    assert.throws(() => planSetup({ cities: invalid }));
});
