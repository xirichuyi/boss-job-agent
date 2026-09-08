import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { harness, stateKey } from './harness-store.js';

export function atomicJson(file, data) {
  const key = stateKey(file), store = key && harness();
  if (store) store.batch([[key, data]]);
  exportJson(file, data);
}

function exportJson(file, data) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(data, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

export function atomicBatch(entries, cycle = null) {
  const store = harness();
  if (!store || entries.some(([file]) => !stateKey(file))) throw Error('Harness未迁移或事务包含非核心状态');
  const values = entries.map(([file, data]) => [stateKey(file), data]);
  if (cycle) store.admit(values, cycle); else store.batch(values);
  for (const [file, data] of entries) exportJson(file, data);
}

export function shanghaiDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function cycleStatus(cycle, now = Date.now()) {
  if (!cycle) return { state: 'idle' };
  if (['completed', 'skipped'].includes(cycle.status)) return { state: cycle.status, cycle: cycle.id };
  if (cycle.status === 'blocked') return { state: 'blocked', cycle: cycle.id, reason: cycle.reason || 'cycle_blocked' };
  const started = Date.parse(cycle.at);
  if (!Number.isFinite(started) || now - started > 20 * 60_000) return { state: 'stalled', cycle: cycle.id, reason: 'cycle_not_finished_within_20_minutes' };
  return { state: 'in_progress', cycle: cycle.id };
}

// Release only explicitly unused capacity of a successfully completed cycle.
// Blocked/unknown cycles keep their reservation until manually reconciled.
export function reconcileQuota(quota, cycle) {
  if (!cycle || !['completed', 'skipped'].includes(cycle.status)) return quota;
  if (quota.settledCycles?.includes(cycle.id)) return quota;
  const used = cycle.result?.newContacts;
  const reserved = cycle.newContactAllocation;
  if (!Number.isInteger(used) || !Number.isInteger(reserved) || used < 0 || used > reserved) return quota;
  if (shanghaiDay(new Date(cycle.at)) !== quota.date) return quota;
  return { ...quota, reserved: Math.max(0, quota.reserved - (reserved - used)), settledCycles: [...(quota.settledCycles || []), cycle.id] };
}
