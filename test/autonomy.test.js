import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionKey, selectInboxBatch, recoveryPlan, retryDelay } from '../src/autonomy.js';
import { reconcileQuota } from '../src/schedule-state.js';
const cycle = { id: 'test-cycle', newContactAllocation: 3, reason: 'Spark决策失败或超时' };
const report = { id: cycle.id, intents: [], result: { newContacts: 0, messagesSent: 0 } };
test('multiple skipped decisions still get distinct file names', () => {
  const names = new Set(Array.from({ length: 100 }, () => decisionKey(cycle.id, 'reply')));
  assert.equal(names.size, 100);
});
test('transient read/model failures recover without sending again', () => {
  assert.equal(recoveryPlan(cycle, report, { contacts: [] }).action, 'retry');
  assert.equal(recoveryPlan({ ...cycle, reason: 'worker_timeout_result_unconfirmed' }, report, { contacts: [] }).action, 'retry');
});
test('unknown send is quarantined and reserved quota cannot be refunded', () => {
  const attempt = { ...report, intents: [{ jobId: 'job1', status: 'outcome_unknown' }] };
  const ledger = { contacts: [{ job: { id: 'job1' }, cycle: cycle.id, status: 'outcome_unknown' }] };
  const plan = recoveryPlan(cycle, attempt, ledger);
  assert.equal(plan.action, 'quarantine');
  assert.equal(plan.retainReservation, true);
  const quota = { date: '2026-09-07', reserved: 3 };
  assert.equal(reconcileQuota(quota, { ...cycle, status: 'quarantined', result: { newContacts: 0 } }).reserved, 3);
});
test('unidentifiable send and missing crash records stop for review', () => {
  assert.equal(recoveryPlan(cycle, null, { contacts: [] }).action, 'review');
  assert.equal(recoveryPlan(cycle, { ...report, intents: [{ jobId: 'missing', status: 'outcome_unknown' }] }, { contacts: [] }).action, 'review');
});
test('login recovery resumes only after a health check', () => {
  const auth = { ...cycle, reason: '需要人工登录或验证' };
  assert.equal(recoveryPlan(auth, report, { contacts: [] }).action, 'authentication');
  assert.equal(recoveryPlan(auth, report, { contacts: [] }, true).action, 'retry');
});
test('inbox cursor covers older contacts instead of last-five starvation', () => {
  const contacts = Array.from({ length: 23 }, (_, id) => ({ job: { id }, status: 'delivered' }));
  let cursor = 0; const seen = new Set();
  for (let i = 0; i < 3; i++) { const b = selectInboxBatch(contacts, cursor); b.entries.forEach(e => seen.add(e.job.id)); cursor = b.next; }
  assert.equal(seen.size, 23);
  assert.equal(selectInboxBatch([{ status: 'quarantined' }]).entries.length, 0);
});
test('retries back off and remain bounded', () => {
  assert.equal(retryDelay(1), 300000);
  assert.ok(retryDelay(4) > retryDelay(1));
  assert.equal(retryDelay(100), 21600000);
});
