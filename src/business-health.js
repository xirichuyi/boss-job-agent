// Observe completed cycles once; never infer a failure merely from zero messages.
export function businessHealth(previous={},cycle,policy={failureCycles:3,minReadFailures:3}) {
  if(!cycle||!['completed','blocked','skipped','quarantined'].includes(cycle.status))return previous;
  if(previous.cycle===cycle.id)return previous;
  const s=cycle.summary||{},inbox=s.inbox||{};
  const readFailed=inbox.readFailed||0;
  const reasons=[];
  if(readFailed>=policy.minReadFailures)reasons.push('会话历史持续读取失败');
  if((inbox.retryDeferred||0)>=policy.minReadFailures)reasons.push('多个联系人仍在失败退避中');
  if(inbox.processingFailed)reasons.push('回复或附件处理失败');
  if(s.contactFailures?.length)reasons.push('首次联系失败');
  if(cycle.status==='blocked')reasons.push('执行周期受阻');
  if((s.reasons?.['详情读取失败']||0)>=policy.minReadFailures)reasons.push('岗位详情读取失败');
  const failureStreak=reasons.length?(previous.failureStreak||0)+1:0;
  return {cycle:cycle.id,checkedAt:new Date().toISOString(),state:failureStreak>=policy.failureCycles?'degraded':reasons.length?'warning':'healthy',failureStreak,reasons,readFailed,unverified:s.inboxDiscovery?.unverified||0,action:failureStreak>=policy.failureCycles?'检查失败联系人和浏览器状态；不因业务告警强杀服务':'observe'};
}
