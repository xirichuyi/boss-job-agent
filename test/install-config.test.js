import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const root = fileURLToPath(new URL('..', import.meta.url));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-install-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('clean install is disabled, repeat init cannot overwrite, disabled tick needs no browser', t => {
  const dir = fixture(t), env = { ...process.env, BOSS_AGENT_ROOT: dir };
  const run = script => spawnSync(process.execPath, [path.join(root, 'scripts', script)], { env, encoding: 'utf8' });
  assert.equal(run('init.mjs').status, 0);
  assert.notEqual(run('init.mjs').status, 0);
  const db = new DatabaseSync(path.join(dir, 'memory/harness.sqlite'));
  const config = JSON.parse(db.prepare("SELECT value FROM documents WHERE key='schedule.json'").get().value);
  assert.equal(config.enabled, false); assert.equal(config.automationReady, false);
  assert.ok(!('intervalMinutes' in config)); db.close();
  const tick = run('scheduled-agent.mjs'); assert.equal(tick.status, 0, tick.stderr);
  assert.match(tick.stdout, /disabled/);
  assert.notEqual(run('enable.mjs').status, 0);
});
test('nondefault config controls prompts, policy, resume and model executable', t => {
  const dir = fixture(t), file = path.join(dir, 'agent.json');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config/agent.json')));
  config.search.city = '上海'; config.search.cityCode = '101020100';
  config.resumeFile = 'custom.pdf'; config.codex.binary = '/test/custom-codex';
  fs.writeFileSync(file, JSON.stringify(config));
  const program = `
    import { AGENT } from './src/agent-config.js';
    import { hardReject } from './src/job-policy.js';
    import { buildPrompt } from './src/prompt-builder.js';
    import { RESUME_FILE } from './src/workflows/conversation-policy.js';
    import { callCodex, MODEL } from './src/codex-adapter.js';
    const bin=callCodex(['-m',MODEL,'read-only'],{},bin=>bin);
    console.log(JSON.stringify({ city:AGENT.search.city, rejected:hardReject({location:'杭州',scaleEvidence:'yes'}), resume:RESUME_FILE, bin, prompt:buildPrompt('contact',{}).text }));`;
  const r = spawnSync(process.execPath, ['--input-type=module','-e', program], { cwd: root, env: { ...process.env, BOSS_AGENT_CONFIG: file }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); const value = JSON.parse(r.stdout);
  assert.equal(value.city, '上海'); assert.ok(value.rejected); assert.equal(value.resume, 'custom.pdf');
  assert.equal(value.bin, '/test/custom-codex'); assert.match(value.prompt, /101020100/);
  config.schedule.perRun = -1; fs.writeFileSync(file, JSON.stringify(config));
  assert.notEqual(spawnSync(process.execPath, ['--input-type=module','-e',program], { cwd:root, env:{...process.env,BOSS_AGENT_CONFIG:file} }).status, 0);
});
