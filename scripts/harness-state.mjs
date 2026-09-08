import { ROOT } from '../src/project-root.js';
import { readState, harness } from '../src/harness-store.js';
import { atomicJson } from '../src/schedule-state.js';
const root = (ROOT + '/memory/');
const [action] = process.argv.slice(2);
if (action === 'timeout') {
  const cycle = readState(root + 'scheduled-cycle.json', {});
  atomicJson(root + 'scheduled-cycle.json', { ...cycle, status: 'blocked', reason: 'worker_timeout_result_unconfirmed', completedAt: new Date().toISOString() });
} else if (action === 'error') {
  atomicJson(root + 'scheduler-status.json', { state: 'error', checkedAt: new Date().toISOString(), reason: 'Python supervisor error; inspect service journal' });
} else if (action === 'enqueue') {
  if (!harness()) throw Error('Harness未迁移');
  console.log(harness().enqueue('manual'));
} else throw Error('未知操作');
