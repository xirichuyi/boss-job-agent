import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CODE_ROOT } from "../src/project-root.ts";
import { installAction } from "../src/installation/flow.ts";
import { renderBootstrapLauncher } from "../src/installation/bootstrap-launcher.ts";

test("system installer parses and rejects invalid arguments before installing packages", () => {
  const file = path.join(CODE_ROOT, "scripts/install-system.sh");
  assert.equal(spawnSync("bash", ["-n", file]).status, 0);
  for (const args of [
    ["--unknown"],
    ["--user", "root"],
    ["--user", "a;id"],
    ["--codex-version", "../bad"],
  ])
    assert.equal(spawnSync("bash", [file, ...args]).status, 2);
  const source = fs.readFileSync(file, "utf8");
  assert.match(source, /sha256sum --check --strict/);
  assert.match(source, /flock -n 9/);
  assert.match(source, /cmp --silent/);
  assert.match(source, /enable --now job-agent-desktop/);
  assert.doesNotMatch(
    source,
    /enable --now job-agent-scheduler|--no-sandbox|scripts\/enable\.ts|cp .*auth\.json/,
  );
});

test("bootstrap creates reusable private workspace and config inherits installed binary paths", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "workspace");
  const run = (browser = "/usr/bin/chromium") =>
    spawnSync(
      process.execPath,
      [
        path.join(CODE_ROOT, "scripts/bootstrap-workspace.ts"),
        directory,
        browser,
        "/opt/tools/codex",
      ],
      { encoding: "utf8" },
    );
  assert.equal(run().status, 0);
  const marker = fs.readFileSync(path.join(directory, "installation.json"));
  assert.equal(run().status, 0);
  assert.deepEqual(
    fs.readFileSync(path.join(directory, "installation.json")),
    marker,
  );
  assert.notEqual(run("/different/browser").status, 0);
  assert.equal(
    fs.existsSync(path.join(directory, "data/memory/harness.sqlite")),
    false,
  );
  await installAction("configure", directory, { answersObject: { perRun: 5 } });
  await installAction("configure", directory, { confirm: true });
  const config = JSON.parse(
    fs.readFileSync(path.join(directory, "config/agent.json"), "utf8"),
  );
  assert.equal(config.browser.binary, "/usr/bin/chromium");
  assert.equal(config.codex.binary, "/opt/tools/codex");
  assert.equal(config.schedule.perRun, 1);
  assert.equal(config.schedule.productionPerRun, 5);
});

test("launcher binds user, Node and workspace without shell interpolation", () => {
  const text = renderBootstrapLauncher(
    "jobagent",
    "/tmp/user's workspace",
    "/opt/node/bin/node",
    "/opt/node/bin:/usr/bin",
  );
  assert.equal(spawnSync("bash", ["-n"], { input: text }).status, 0);
  assert.match(text, /runuser -u 'jobagent'/);
  assert.match(text, /env -u CODEX_HOME/);
  assert.match(text, /"\$@" --workspace/);
  assert.throws(() =>
    renderBootstrapLauncher("root", "/tmp/test", "/bin/node", "/bin"),
  );
  assert.throws(() =>
    renderBootstrapLauncher("jobagent", "relative", "/bin/node", "/bin"),
  );
});
