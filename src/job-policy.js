import { rejectJobFilters } from './job-filters.js';
import { AGENT } from './agent-config.js';
export function hardReject(job) {
  if (!job.location?.startsWith(AGENT.search.city)) return '工作地点不是' + AGENT.search.city;
  if (!job.scaleEvidence) return '没有目标公司规模证据';
  return rejectJobFilters(job);
}

export function validateOutwardMessage(message) {
  // Transport precondition only; wording and factual constraints stay in prompts.
  if (typeof message !== 'string' || !message.trim()) throw Error('对外消息必须为非空字符串');
  return message;
}

export function validateDecision(value) {
  if (!value || !['contact', 'reply', 'skip'].includes(value.action) || typeof value.reason !== 'string' || typeof value.message !== 'string') throw new Error('模型结果结构不合法');
  if (value.action === 'skip' && value.message !== '') throw new Error('跳过时不得携带对外正文');
  if (value.action !== 'skip') validateOutwardMessage(value.message, value.action);
  return value;
}
