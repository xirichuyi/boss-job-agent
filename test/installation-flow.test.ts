import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { installAction } from "../src/installation/flow.ts";
import {
  configOf,
  databaseValue,
  evidence,
  fingerprint,
  initialDesktop,
  installationLock,
  verified,
  workspace,
  writePrivate,
} from "../src/installation/workspace.ts";
import { planSetup } from "../src/config/setup.ts";
import { desktopConfig } from "../src/config/desktop.ts";
import {
  importProfile,
  validateProfile,
} from "../src/config/profile-import.ts";
import { renderServices, writeServices } from "../src/installation/services.ts";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "job-install-flow-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "workspace");
}
test("resumable workflow previews, confirms and initializes without enabling sends", async (t) => {
  const root = fixture(t),
    { state } = workspace(root, true);
  initialDesktop(state);
  assert.equal(
    fs.existsSync(state.config),
    false,
    "desktop does not need business config",
  );
  const preview = await installAction("configure", root, {
    answersObject: {
      minimumMonthlySalaryYuan: 6000,
      perRun: 5,
      intervalMinutes: 45,
      dailyNewContactLimit: 20,
      directions: "后端",
      ignoreEducationAndExperience: false,
      excludeInternships: false,
      browserBinary: "/custom/chrome",
    },
  });
  assert.equal(preview.preview.salaryBeforeTaxYuanPerMonth, 6000);
  assert.equal(preview.preview.productionPerRun, 5);
  assert.equal(fs.existsSync(state.config), false);
  await installAction("configure", root, { confirm: true });
  const files = configOf(state);
  assert.equal(files.agent.schedule.perRun, 1);
  assert.equal(files.agent.schedule.productionPerRun, 5);
  assert.equal(files.agent.browser.binary, "/custom/chrome");
  assert.equal(files.agent.search.ignoreEducationAndExperience, false);
  await assert.rejects(
    installAction("profile", root, { text: "填写自己的姓名" }),
    /真实简历/,
  );
  const text = "本人有Go网关、企业知识库项目开发经历。";
  await installAction("profile", root, { text });
  assert.equal(
    fs.existsSync(path.join(state.data, "candidate-profile.md")),
    false,
  );
  await installAction("profile", root, { confirm: true });
  await installAction("initialize", root);
  const before = fs.readFileSync(
    path.join(state.data, "memory/harness.sqlite"),
  );
  await installAction("initialize", root);
  assert.deepEqual(
    fs.readFileSync(path.join(state.data, "memory/harness.sqlite")),
    before,
  );
  assert.equal(databaseValue(state, "schedule.json").enabled, false);
  const formal = await installAction("activate", root);
  assert.equal(formal.preview.productionPerRun, 5);
  await assert.rejects(
    installAction("activate", root, { "confirm-real-sends": true }),
    /真实验收/,
  );
  assert.equal(databaseValue(state, "schedule.json").enabled, false);
  assert.equal(
    fs.statSync(path.join(root, "installation.json")).mode & 0o777,
    0o600,
  );
  assert.ok(workspace(root).state.lastError);
  await installAction("pause", root);
  assert.equal(databaseValue(state, "schedule.json").enabled, false);
});

test("formal promotion fingerprint supports restart but rejects changed profile", (t) => {
  const { state } = workspace(fixture(t), true);
  initialDesktop(state);
  const files = planSetup({ perRun: 5 });
  for (const [name, value] of Object.entries(files))
    writePrivate(path.join(state.config, name + ".json"), value);
  writePrivate(
    path.join(state.data, "candidate-profile.md"),
    "本人后端项目经历",
  );
  evidence(state, "acceptance", {});
  const source = fingerprint(state);
  files.agent.schedule.perRun = 5;
  const target = fingerprint(state, files.agent);
  assert.notEqual(source, target);
  writePrivate(path.join(state.config, "agent.json"), files.agent);
  assert.equal(fingerprint(state), target);
  assert.equal(verified(state, "acceptance"), false);
  evidence(state, "production", {});
  assert.equal(verified(state, "production"), true);
  writePrivate(
    path.join(state.data, "candidate-profile.md"),
    "修改后的个人资料",
  );
  assert.notEqual(fingerprint(state), target);
  assert.equal(verified(state, "production"), false);
});

test("evidence invalidates only affected checks; early browser login survives business setup", (t) => {
  const root = fixture(t),
    { state } = workspace(root, true);
  initialDesktop(state);
  evidence(state, "browser", {});
  assert.equal(verified(state, "browser"), true);
  const files = planSetup({});
  for (const [name, value] of Object.entries(files))
    writePrivate(path.join(state.config, name + ".json"), value);
  assert.equal(verified(state, "browser"), true);
  evidence(state, "model", {});
  evidence(state, "attachment", {});
  evidence(state, "acceptance", {});
  files.agent.resumeFile = "English CV.pdf";
  writePrivate(path.join(state.config, "agent.json"), files.agent);
  assert.equal(
    verified(state, "model"),
    true,
    "filename changes do not burn another model probe",
  );
  assert.equal(verified(state, "attachment"), false);
  assert.equal(verified(state, "acceptance"), false);
  files.model.model = "different-model";
  writePrivate(path.join(state.config, "model.json"), files.model);
  assert.equal(verified(state, "model"), false);
});

test("installer lock survives interruptions without concurrent mutation", (t) => {
  const root = fixture(t),
    { state } = workspace(root, true);
  const unlock = installationLock(state);
  assert.throws(() => installationLock(state), /正在运行/);
  unlock();
  fs.writeFileSync(path.join(root, "installation.lock"), "99999999");
  installationLock(state)();
  assert.equal(fs.existsSync(path.join(root, "installation.lock")), false);
});

test("salary units and fixed scale options reject ambiguous input", () => {
  for (const value of [6, "6/月", "6000", 0, -10])
    assert.throws(
      () => planSetup({ minimumMonthlySalaryYuan: value }),
      /税前元/,
    );
  assert.throws(
    () =>
      planSetup({ minimumMonthlySalaryYuan: 6000, minimumMonthlySalaryK: 6 }),
    /单位/,
  );
  assert.throws(
    () => planSetup({ minimumCompanySize: "20–100人以上" }),
    /公司规模/,
  );
  assert.throws(() => planSetup({ perRun: 11 }), /perRun/);
  assert.throws(
    () => planSetup({ ignoreEducationAndExperience: "yes" }),
    /布尔/,
  );
});

test("document converters are local, bounded and do not accept empty extraction", (t) => {
  const root = path.dirname(fixture(t));
  for (const ext of ["pdf", "docx", "doc"]) {
    const file = path.join(root, "file with spaces." + ext);
    fs.writeFileSync(file, "fixture");
    const runner = (binary, args, options) => {
      assert.ok(["pdftotext", "pandoc", "antiword"].includes(binary));
      assert.ok(args.includes(file));
      assert.equal(options.timeout, 30000);
      assert.equal(options.shell, undefined);
      return { status: 0, stdout: "本人项目经历" };
    };
    assert.equal(importProfile(file, runner as any), "本人项目经历\n");
    assert.throws(
      () => importProfile(file, (() => ({ status: 0, stdout: "" })) as any),
      /OCR/,
    );
    assert.throws(
      () => importProfile(file, (() => ({ status: 1 })) as any),
      /转换失败/,
    );
  }
  for (const text of ["", "/绝对路径/resume.md", "禁止把示例当真实经历"])
    assert.throws(() => validateProfile(text));
});

test("desktop config and service templates preserve user, paths and loopback security", (t) => {
  const root = fixture(t),
    { state } = workspace(root, true);
  initialDesktop(state);
  assert.ok(
    desktopConfig({
      BOSS_DESKTOP_CONFIG: state.desktop,
    } as any).cdpUrl.includes("127.0.0.1"),
  );
  const services = renderServices(
    { ...state, user: "jobagent" },
    "/custom/node",
  );
  assert.match(services["job-agent-desktop.service"], /BOSS_DESKTOP_CONFIG=/);
  assert.match(services["job-agent-scheduler.service"], /BOSS_CONFIG_DIR=/);
  assert.match(services["job-agent-scheduler.service"], /User=jobagent/);
  assert.doesNotMatch(
    Object.values(services).join("\n"),
    /sudo|--no-sandbox|@USER@/,
  );
  assert.throws(() => renderServices({ ...state, user: "root" }), /非 root/);
  const serviceState = { ...state, user: "jobagent" };
  const output = writeServices(serviceState);
  assert.equal(writeServices(serviceState), output);
  fs.appendFileSync(
    path.join(output, "job-agent-desktop.service"),
    "# user edit\n",
  );
  assert.throws(() => writeServices(serviceState), /拒绝覆盖/);
  const d = JSON.parse(fs.readFileSync(state.desktop, "utf8"));
  writePrivate(state.desktop, { ...d, cdpUrl: "http://0.0.0.0:9222" });
  assert.throws(
    () => desktopConfig({ BOSS_DESKTOP_CONFIG: state.desktop } as any),
    /本机/,
  );
});
