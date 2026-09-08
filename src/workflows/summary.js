export function summarizeCycle(report) {
  const reasons = {};
  for (const job of report.jobReviews || []) {
    const why = job.rejected || (job.decision?.action === 'skip' ? (job.decision.retryable ? '模型调用或输出异常，待重试' : '模型判断不匹配') : null);
    if (!why) continue;
    const category = /详情读取失败/.test(why) ? '详情读取失败' : /已有联系人|账本防重|已联系或按钮/.test(why) ? '已有联系或发送状态不明' : why;
    reasons[category] = (reasons[category] || 0) + 1;
  }
  const sent = report.result?.messagesSent || 0;
  return { listCount: report.listCount || 0, reviewed: (report.jobReviews || []).length,
    detailReads: (report.jobReviews || []).filter(j => j.text).length, reasons,
    outcome: report.status === 'blocked' ? 'blocked' : sent ? 'messages_confirmed' : 'completed_no_send',
    explanation: sent ? `已确认发送${sent}条消息` : report.status === 'blocked' ? `未确认新消息，执行异常：${report.reason}` : '本轮执行完成但未发送：岗位被筛选/防重跳过，或没有可自动回复的新消息。',
    inbox: report.inboxSummary || {} };
}
