import { shanghaiDay } from '../schedule-state.js';
import { AGENT } from '../agent-config.js';
import { pendingWrite } from './reconcile.js';
import { hardReject } from '../job-policy.js';
import { classifyFailure } from '../autonomy.js';
export async function contactJobs({list, cycle, ledger, report, jobs, chat, decide, progress, save, assertAuthority, deadline = Infinity}) {
  const priorDetails = report.jobReviews.filter(j => j.text).length;
  const candidates = [];
  const batchLimit = Math.min(3, cycle.newContactAllocation - report.result.newContacts);
  if (batchLimit <= 0) return;
  for (const card of list) {
    if (Date.now() >= deadline) { report.searchStop = '达到本轮搜索时长，转入回复阶段'; break; }
    if (candidates.length >= batchLimit) break;
    if (candidates.some(x => x.job.company === card.company)) { report.jobReviews.push({ ...card, rejected: '本批次同公司去重' }); save(); continue; }
    if (ledger.contacts.some(e => e.job.id === card.id || e.job.company === card.company)) {
      report.jobReviews.push({ ...card, rejected: '账本防重：该岗位或公司已联系/隔离' }); save(); continue;
    }
    const simple = hardReject(card);
    if (simple) { report.jobReviews.push({ ...card, rejected: simple }); save(); continue; }
    if (report.jobReviews.filter(j => j.text).length - priorDetails >= AGENT.workflow.detailReadsPerBatch) break;
    progress('read_inline_jd', { company: card.company, job: card.title });
    let detail;
    try { detail = await jobs.detail(card.id); }
    catch (error) {
      if (classifyFailure(error.message) !== 'transient') throw error;
      report.jobReviews.push({ ...card, rejected: '本轮详情读取失败，未发送：' + error.message }); save();
      continue;
    }
    const job = { ...card, ...detail };
    report.jobReviews.push(job); save();
    const reason = hardReject(job);
    if (reason) { job.rejected = reason; save(); continue; }
    if (!job.buttons.some(b => b.text === '立即沟通')) { job.rejected = '已联系或按钮状态不明'; save(); continue; }
    if (!await jobs.contactReady(job)) { job.rejected = '平台沟通按钮不可用，未点击'; save(); continue; }
    const history = await chat.searchHistory(job.company);
    job.historyCheck = history; save();
    if (!history.empty) { job.rejected = '公司已有联系人，保守防重：人工核对后再联系'; save(); continue; }
    candidates.push({ job, history });
  }
  if (!candidates.length || Date.now() >= deadline) return;
  const decisions = decide.batch ? decide.batch(candidates) : candidates.map(({ job, history }) => decide(job, history, 'contact'));
  for (let i = 0; i < candidates.length; i++) {
    if (Date.now() >= deadline || report.result.newContacts >= cycle.newContactAllocation) break;
    const { job } = candidates[i], decision = decisions[i];
    job.decision = decision; save();
    if (decision.action === 'skip') continue;
    if (ledger.contacts.some(e => e.job.id === job.id || e.job.company === job.company)) { job.rejected = '发送前同公司去重'; save(); continue; }
    // Revalidate selected JD immediately before a write; never navigate by guessed URL.
    const current = await jobs.detail(job.id);
    const freshRejection = hardReject({ ...job, ...current });
    if (freshRejection) { job.rejected = freshRejection; save(); continue; }
    if (current.text.split('职位描述')[1]?.split(job.recruiter)[0] !== job.text.split('职位描述')[1]?.split(job.recruiter)[0]) throw new Error('发送前JD变化，需要重新匹配');
    if (!await jobs.contactReady(job)) {
      job.rejected = '平台沟通按钮不可用，未点击；后续轮次可重新检查'; save(); continue;
    }
    if (!(await chat.searchHistory(job.company)).empty) { job.rejected = '发送前平台已有公司联系人，未发送'; save(); continue; }
    if (shanghaiDay() !== shanghaiDay(new Date(cycle.at))) break; // Next day must reserve its own quota.
    assertAuthority();
    const intent = { kind: 'first_contact', jobId: job.id, company: job.company, recruiter: job.recruiter, message: decision.message, at: new Date().toISOString(), status: 'outcome_unknown' };
    const entry = { job, status: 'outcome_unknown', cycle: cycle.id, intent };
    ledger.contacts.push(entry); report.intents.push(intent); save();
    progress('contact_once', { company: job.company, recruiter: job.recruiter });
    await jobs.contactOnce(job);
    const conversation = await chat.openConversation(job);
    const human = conversation.messages.filter(m => !/^你与该职位竞争者/.test(m.text));
    if (human.length !== 1 || !human[0].self || !/送达|已读/.test(human[0].text)) throw new Error('首次联系后的历史不符合预期，停止发送');
    report.result.newContacts++; report.result.messagesSent++;
    intent.status = 'platform_greeting_delivered'; report.receipts.push({ kind: 'greeting', text: human[0].text }); save();
    const supplement = { kind: 'targeted_message', jobId: job.id, message: decision.message, status: 'prepared' };
    report.intents.push(supplement); save();
    progress('send_targeted_message', { company: job.company, recruiter: job.recruiter });
    const receipt = await chat.sendText(job, decision.message, conversation, () => { assertAuthority(); supplement.status = 'outcome_unknown'; entry.pendingWrite = pendingWrite('text', conversation, { message: decision.message }); save(); });
    supplement.status = 'delivered'; entry.status = 'delivered'; entry.receipt = receipt; delete entry.pendingWrite;
    report.receipts.push(receipt); report.result.messagesSent++; save();
  }
}
