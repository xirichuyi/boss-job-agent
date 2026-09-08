import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { atomicJson } from './schedule-state.js';

export function raiseAlert(root, alert) {
  const path = root + '/memory/alerts.json';
  const list = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : [];
  const id = createHash('sha256').update(`${alert.kind}:${alert.contact || alert.cycle || 'system'}`).digest('hex').slice(0, 16);
  const previous = list.find(x => x.id === id);
  const value = { ...alert, id, status: 'open', firstSeen: previous?.firstSeen || new Date().toISOString(), lastSeen: new Date().toISOString(), occurrences: (previous?.occurrences || 0) + 1 };
  if (previous) Object.assign(previous, value); else list.push(value);
  atomicJson(path, list);
  console.error(JSON.stringify({ alert: value }));
  return value;
}
