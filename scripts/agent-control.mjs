import { ROOT } from '../src/project-root.js';
import { readState, harness } from '../src/harness-store.js';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { atomicJson } from '../src/schedule-state.js';
const root = (ROOT + '/memory/');
const action = process.argv[2];
const config = readState(root + 'schedule.json');
if (!['pause', 'resume', 'maintenance'].includes(action)) throw Error('用法：agent-control.mjs pause|resume|maintenance [分钟，1-120]');
if (action === 'maintenance') {
  const minutes = Number(process.argv[3]);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw Error('维护必须有1-120分钟的明确到期时间');
  atomicJson(root + 'maintenance.json', { until: new Date(Date.now() + minutes * 60000).toISOString() });
} else {
  config.enabled = action === 'resume'; atomicJson(root + 'schedule.json', config);
  atomicJson(root + 'maintenance.json', { until: null });
}
const result = spawnSync('/usr/bin/systemctl', [action === 'resume' ? 'start' : 'stop', 'job-agent-scheduler.service'], { stdio: 'inherit', timeout: 25000 });
if (result.status !== 0) process.exit(1);
console.log(action === 'maintenance' ? '维护到期后看门狗自动恢复' : action === 'pause' ? '已明确暂停；看门狗不会拉起' : '已恢复自动运行');
