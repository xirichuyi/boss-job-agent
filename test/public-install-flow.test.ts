import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { planSetup, writeSetup } from "../src/config/setup.ts";

test("fresh public tree runs TS supervisor → dispatcher safely, with one private config and graceful pause", (t) => {
  const source = fileURLToPath(new URL("..", import.meta.url));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-public-flow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ["scripts", "src", "config", "package.json"]) {
    fs.cpSync(path.join(source, name), path.join(root, name), {
      recursive: true,
      filter: (p) => !p.includes("/private") && !p.includes("__pycache__"),
    });
  }
  const configDir = path.join(root, "private-config");
  writeSetup(
    configDir,
    planSetup({ cities: ["南京"], resumeFile: "验收简历.pdf" }),
  );
  const env = {
    ...process.env,
    BOSS_AGENT_ROOT: root,
    BOSS_CONFIG_DIR: configDir,
    NODE_BINARY: process.execPath,
  };
  for (const key of [
    "BOSS_AGENT_CONFIG",
    "BOSS_JOB_FILTERS_CONFIG",
    "JOB_AGENT_FORCE",
    "JOB_AGENT_LEASE",
  ])
    delete env[key];
  const run = (binary, args) => {
    const result = spawnSync(binary, args, {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return result.stdout;
  };
  run(process.execPath, ["scripts/init.ts"]);
  const tick = run(process.execPath, ["scripts/scheduler.ts", "--once"]);
  assert.match(tick, /"state":"disabled"/);
  const status = () =>
    JSON.parse(run(process.execPath, ["scripts/agent-status.ts"]));
  assert.equal(status().configuration.search.cities[0].name, "南京");
  assert.equal(status().configuration.resumeFile, "验收简历.pdf");
  assert.equal(status().schedule.automationReady, false);
  run(process.execPath, ["scripts/agent-control.ts", "resume", "--state-only"]);
  assert.equal(status().schedule.enabled, true);
  run(process.execPath, ["scripts/agent-control.ts", "pause"]);
  assert.equal(status().schedule.enabled, false);
  assert.doesNotMatch(
    fs.readFileSync(path.join(root, "scripts/agent-control.ts"), "utf8"),
    /['"]stop['"]/,
  );
  assert.equal(fs.readdirSync(path.join(root, "memory/cycles")).length, 0);
});
