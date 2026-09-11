import { executionConfig } from '../task-coordinator.js';
import { classifyFailure } from '../autonomy.js';
import { raiseAlert } from '../alerts.js';

export function stopAll(error) {
  return ['TASK_PAUSED','LEASE_LOST','ENOSPC','EIO','EACCES','EROFS','ERR_SQLITE_ERROR'].includes(error.code) || classifyFailure(error.message)==='authentication';
}
export function deferInbox(root, entry, error, now=Date.now()) {
  const policy=executionConfig().inboxRetry;
  const attempts=(entry.inboxRetry?.attempts||0)+1;
  const minutes=Math.min(policy.maxMinutes,policy.baseMinutes*2**Math.min(attempts-1,20));
  entry.inboxRetry={attempts,reason:error.message,nextAt:new Date(now+minutes*60000).toISOString(),needsAttention:attempts>=policy.escalateAfter};
  // A write that reached its callback stays unknown. Never reset or resend it here.
  if(attempts>=policy.escalateAfter)raiseAlert(root,{kind:'inbox_recovery_exhausted',contact:entry.job.id,reason:'某联系人持续处理失败，已延长重试间隔；其他联系人继续，详情见状态记录。'});
}
