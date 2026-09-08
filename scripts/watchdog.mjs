import { ROOT } from '../src/project-root.js';
import { readState, harness } from '../src/harness-store.js';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { atomicJson } from '../src/schedule-state.js';
import { watchdogPlan, serviceHealth } from '../src/service-health.js';
const root = (ROOT + '/memory/');
const read = (name, fallback = {}) => readState(root + name, fallback);
const now = Date.now();
const config = read('schedule.json');
const maintenance = read('maintenance.json');
const previous = read('watchdog-state.json');
const service = serviceHealth();
const heartbeat = read('scheduler-heartbeat.json');
const status = read('scheduler-status.json');
const latest = Math.max(Date.parse(heartbeat.at || '') || 0, Date.parse(status.checkedAt || '') || 0);
const attempts = (previous.attempts || []).filter(t => now - t < 15 * 60000);
const plan = watchdogPlan({ enabled: config.enabled, maintenance, service: service.state,
  ageSeconds: (now - latest) / 1000, bootGrace: now - (attempts.at(-1) || 0) < 90000, attempts: attempts.length }, now);
const state = { checkedAt: new Date().toISOString(), service, plan, attempts, lastNotification: previous.lastNotification };
if (['start_stopped', 'restart_stale'].includes(plan)) {
  attempts.push(now); atomicJson(root + 'watchdog-state.json', state);
  const r = spawnSync('/usr/bin/systemctl', [plan === 'start_stopped' ? 'start' : 'restart', 'job-agent-scheduler.service'], { timeout: 25000, encoding: 'utf8' });
  state.recovery = { at: new Date().toISOString(), success: r.status === 0, service: serviceHealth() };
}
atomicJson(root + 'watchdog-state.json', state);
console.log(JSON.stringify(state));
