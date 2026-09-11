import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configFile } from '../src/config-files.js';
import { planSetup, writeSetup } from '../src/setup-config.js';
import { diagnose } from '../src/doctor.js';
import { effectiveConfig } from '../src/effective-config.js';
const code=fileURLToPath(new URL('..',import.meta.url));
function temp(t){const p=fs.mkdtempSync(path.join(os.tmpdir(),'boss-setup-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
test('one config directory resolves all files; explicit legacy override remains visible',()=>{
  assert.equal(configFile('model',{BOSS_CONFIG_DIR:'/private'}),'/private/model.json');
  assert.equal(configFile('agent',{BOSS_CONFIG_DIR:'/private',BOSS_AGENT_CONFIG:'/old.json'}),'/old.json');
  assert.throws(()=>configFile('../token'));
});
test('setup generates private configs, never overwrites and defaults to one contact',t=>{
  const root=temp(t),files=planSetup({cities:['深圳'],minimumMonthlySalaryK:20,resumeFile:'我的简历.pdf'});
  const dir=path.join(root,'config');writeSetup(dir,files);
  assert.equal(files.agent.schedule.perRun,1);assert.equal(files['job-filters'].cities[0].name,'深圳');
  assert.ok(files['job-filters'].nativeSalaryCodes.includes(405));
  assert.equal(fs.statSync(dir).mode&0o777,0o700);
  assert.equal(fs.statSync(dir+'/agent.json').mode&0o777,0o600);
  assert.throws(()=>writeSetup(dir,files),/拒绝覆盖/);
  assert.equal(fs.existsSync(root+'/memory'),false);
});
test('setup rejects invalid preferences before writing',()=>{
  assert.throws(()=>planSetup({cities:['unknown']}));
  assert.throws(()=>planSetup({minimumMonthlySalaryK:-1}));
  assert.throws(()=>planSetup({minimumCompanySize:123}));
  assert.throws(()=>planSetup({resumeFile:'../resume.pdf'}));
});
test('fresh generated config is loaded by status and safe initialization',t=>{
  const root=temp(t),dir=path.join(root,'private');
  writeSetup(dir,planSetup({cities:['成都'],resumeFile:'custom.pdf'}));
  const env={...process.env,BOSS_AGENT_ROOT:root,BOSS_CONFIG_DIR:dir};
  delete env.BOSS_AGENT_CONFIG;delete env.BOSS_JOB_FILTERS_CONFIG;
  const init=spawnSync(process.execPath,[code+'/scripts/init.mjs'],{env,encoding:'utf8'});
  assert.equal(init.status,0,init.stderr);
  const r=spawnSync(process.execPath,[code+'/scripts/agent-status.mjs'],{env,encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const result=JSON.parse(r.stdout);
  assert.equal(result.configuration.search.cities[0].name,'成都');
  assert.equal(result.configuration.resumeFile,'custom.pdf');
  assert.equal(result.schedule.enabled,false);
});
test('doctor reports missing components with fixes, without fetching in offline mode',async t=>{
  const root=temp(t);
  const result=await diagnose({root,config:effectiveConfig(),offline:true,run:()=>({status:1}),fetcher:()=>assert.fail('offline')});
  assert.equal(result.ok,false);
  assert.ok(result.checks.filter(c=>c.status==='error').every(c=>c.fix));
  assert.ok(result.checks.some(c=>c.name==='profile'));
  assert.equal(fs.readdirSync(root).length,0);
});
test('doctor does not confuse existing tabs with verified login or model permission',async t=>{
  const root=temp(t);fs.mkdirSync(root+'/memory');
  fs.writeFileSync(root+'/candidate-profile.md','真实经历',{mode:0o600});fs.writeFileSync(root+'/memory/harness.sqlite','',{mode:0o600});
  const result=await diagnose({root,config:effectiveConfig(),run:b=>({status:0,stdout:b==='python3'?'Python 3.11.0':''}),fetcher:async()=>({ok:true,json:async()=>['jobs','chat'].map(n=>({type:'page',url:'https://www.zhipin.com/web/geek/'+n}))})});
  assert.equal(result.ok,true);assert.ok(result.checks.some(c=>c.name==='manual-verification'&&c.status==='warning'));
});
