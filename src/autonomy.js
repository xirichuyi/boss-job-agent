import { randomUUID } from 'node:crypto';

export function decisionKey(cycleId, mode) { return `${cycleId}.${mode}.${randomUUID()}`; }

export function classifyFailure(reason = '') {
  if (/登录|验证|访问受限|异常访问|业务错误\s*(?:37|121)/.test(reason)) return 'authentication';
  if (/用量限额冷却|超时|timeout|fetch failed|ECONN|连接|页面内容未就绪|worker_timeout|worker_failed|页面尚未|内容尚未|历史变化|JD变化/i.test(reason)) return 'transient';
  return 'review';
}

export function retryDelay(attempt) { return Math.min(6 * 60, 5 * 2 ** Math.min(8, Math.max(0, attempt - 1))) * 60_000; }

export function selectInboxBatch(contacts, cursor = 0, limit = 10) {
  const eligible = contacts.filter(e => e.status === 'delivered');
  if (!eligible.length) return { entries: [], next: 0 };
  const count = Math.min(limit, eligible.length);
  return { entries: Array.from({ length: count }, (_, i) => eligible[(cursor + i) % eligible.length]), next: (cursor + count) % eligible.length };
}

export function recoveryPlan(cycle, report, ledger, authReady = false) {
  const reason = cycle.reason || report?.reason || 'worker_failed_or_result_unconfirmed';
  if (!report || report.id !== cycle.id || !Array.isArray(report.intents)) return { action: 'review', reason: '缺少可靠周期记录，不能自动释放额度或重发' };
  const count = report.result?.newContacts;
  if (!Number.isInteger(count) || count < 0 || count > cycle.newContactAllocation) return { action: 'review', reason: '联系人计数无法核对' };
  const unresolved = report.intents.filter(i => !['delivered', 'platform_greeting_delivered', 'cancelled'].includes(i.status));
  const uncertain = ledger.contacts.filter(e => e.cycle === cycle.id && e.status === 'outcome_unknown');
  if (unresolved.length || uncertain.length) {
    // Only isolate a failed write when its exact recipient is durably identifiable.
    if (unresolved.some(i => !ledger.contacts.some(e => e.job.id === i.jobId))) return { action: 'review', reason: '未知发送缺少联系人索引，需要人工对账' };
    return { action: 'quarantine', reason: '隔离结果不明的联系人，保留全部预留额度，其他联系人可继续', unresolved: unresolved.map(i => i.jobId), retainReservation: true };
  }
  const type = classifyFailure(reason);
  if (type === 'authentication' && !authReady) return { action: 'authentication', reason };
  if (type === 'transient' || (type === 'authentication' && authReady)) return { action: 'retry', reason, result: report.result };
  return { action: 'review', reason };
}
