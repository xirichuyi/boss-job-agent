import fs from 'node:fs';
import { readState } from './harness-store.js';
import { atomicJson } from './schedule-state.js';
import { MODEL } from './model-config.js';
function budgets(root) {
  const state = readState(root + '/memory/model-budget.json', {});
  return state.byModel || ((state.until || state.attempts) ? { [state.model || 'gpt-5.3-codex-spark']: state } : {});
}
function saveBudget(root, state) {
  atomicJson(root + '/memory/model-budget.json', { byModel: { ...budgets(root), [MODEL]: { ...state, model: MODEL } } });
}
export function cooldown(root, now = Date.now()) {
  const state = budgets(root)[MODEL] || {};
  return Date.parse(state.until || '') > now ? state : null;
}
export function budgetError(state) {
  const error = Error(MODEL + '用量限额冷却，等待至 ' + state.until);
  error.code = 'MODEL_COOLDOWN'; error.until = state.until; return error;
}
export function checkBudget(root) {
  const state = cooldown(root); if (state) throw budgetError(state);
}
export function recordUsage(root, logPath, now = Date.now()) {
  if (!logPath || !fs.existsSync(logPath)) return;
  const events = fs.readFileSync(logPath, 'utf8').split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const limited = events.some(e => ['error', 'turn.failed'].includes(e.type) && /usage limit|rate.limit|quota exceeded|用量.*限|额度.*不足/i.test(e.message || e.error?.message || ''));
  if (limited) {
    const old = budgets(root)[MODEL] || {};
    const attempts = (old.attempts || 0) + 1;
    // Provider's "7:53 AM" has no timezone/date: do not guess a reset timestamp.
    const until = new Date(Math.max(Date.parse(old.until || '') || 0, now + Math.min(120, 15 * 2 ** Math.min(attempts - 1, 3)) * 60000)).toISOString();
    const state = { until, attempts, observedAt: new Date(now).toISOString(), reason: MODEL + ' usage limit', resetTimeSource: 'local_backoff_not_provider_reset' };
    saveBudget(root, state); throw budgetError(state);
  }
  const completed = events.filter(e => e.type === 'turn.completed');
  if (completed.length && !cooldown(root, now)) saveBudget(root, { until: null, attempts: 0 });
  if (completed.length) atomicJson(logPath + '.usage.json', { calls: completed.length, usage: completed.map(e => e.usage) });
}
