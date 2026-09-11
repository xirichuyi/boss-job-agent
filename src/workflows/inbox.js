import fs from 'node:fs';
import { deferInbox, stopAll } from './inbox-retry.js';
import { AGENT } from '../agent-config.js';
import { pendingWrite } from './reconcile.js';
import { rejectJobFilters, loadJobFilters } from '../job-filters.js';
import { createHash } from 'node:crypto';
import { readState } from '../harness-store.js';
import { atomicJson } from '../schedule-state.js';
import { selectInboxBatch, classifyFailure } from '../autonomy.js';
import { raiseAlert } from '../alerts.js';
import { conversationState, RESUME_FILE } from './conversation-policy.js';
export async function checkInbox({root, ledger, report, chat, decide, progress, save, assertAuthority, deadline = Infinity}) {
  // Existing verified contacts only. No responding to unknown-company inboxes.
  const inboxPath = root + '/memory/inbox-cursor.json';
  const inbox = readState(inboxPath, { next: 0 });
  const eligible = ledger.contacts.filter(e=>e.status==='delivered');
  let unreadEntries = [];
  let visibleRows = [];
  if (chat.scanConversations && Date.now()<deadline) {
    try {
      const discovery = await chat.scanConversations({deadline:Math.min(deadline,Date.now()+loadJobFilters().conversationLookupMs)});
      const matches=(row,e)=>row.recruiter===e.job.recruiter && row.label.includes(e.job.company);
      const unread=discovery.rows.filter(r=>r.unread);
      visibleRows=discovery.rows;
      unreadEntries=eligible.filter(e=>unread.some(r=>matches(r,e)));
      const unverified=unread.filter(r=>!ledger.contacts.some(e=>matches(r,e)));
      report.inboxDiscovery={scanned:discovery.rows.length,unread:unread.length,unverified:unverified.length,reachedRenderedEnd:discovery.complete};
      atomicJson(root+'/memory/inbox-discovery.json',{capturedAt:new Date().toISOString(),...report.inboxDiscovery,unverified,action:'未核实身份和岗位的联系人不自动发送，保留待核实记录'});
    } catch(error) {
      if(classifyFailure(error.message)==='authentication')throw error;
      report.inboxDiscovery={error:error.message};
    }
  }
  const batch = selectInboxBatch(ledger.contacts, inbox.next, AGENT.workflow.inboxContactsPerRun);
  // Prioritize all known unread contacts, including those outside the cursor slice.
  const visibleEntries=batch.entries.filter(e=>visibleRows.some(r=>r.recruiter===e.job.recruiter&&r.label.includes(e.job.company)));
  const ordered=[...new Set([...unreadEntries,...visibleEntries,...batch.entries])];
  const originalEntries=batch.entries;
  batch.entries=ordered;
  const checkedEntries=new Set();
  let processed = 0;
  report.historyChecks = [];
  report.inboxSummary = { checked: 0, noNewMessage: 0, alreadyHandled: 0, pending: 0, readFailed: 0 };
  for (const entry of batch.entries) {
    if (Date.now() >= deadline) { report.inboxDeferred = true; break; }
    processed++;
    checkedEntries.add(entry);
    if(Date.parse(entry.inboxRetry?.nextAt||'')>Date.now()) {
      report.inboxSummary.retryDeferred=(report.inboxSummary.retryDeferred||0)+1;
      continue;
    }
    try {
    const excluded = rejectJobFilters(entry.job);
    if (excluded) { entry.pendingUser = excluded; report.inboxSummary.excluded = (report.inboxSummary.excluded || 0) + 1; save(); continue; }
    progress('check_existing_history', { company: entry.job.company });
    let history = await chat.openConversation(entry.job).catch(error => {
      report.historyChecks.push({ jobId: entry.job.id, status: 'failed', reason: error.message });
      entry.historyFailures = (entry.historyFailures || 0) + 1; save();
      raiseAlert(root, { kind: 'history_read_failed', contact: entry.job.id, reason: '某已联系HR历史暂时读取失败，轮询会继续重试。' });
      if (stopAll(error)) throw error;
      deferInbox(root,entry,error);save();
      return null;
    });
    if (!history) { report.inboxSummary.readFailed++; continue; }
    report.inboxSummary.checked++;
    entry.historyFailures = 0;
    report.historyChecks.push({ jobId: entry.job.id, status: 'read', at: new Date().toISOString() }); save();
    let state = conversationState(history);
    entry.platformCheckedAt = new Date().toISOString();
    entry.platformHistory = history; // Current UI is authoritative, including manual activity.
    if (state.receipt) {
      entry.platformAttachment = { text: state.receipt.text, id: state.receipt.id, observedAt: entry.platformCheckedAt, source: 'platform_observed_not_counted_as_agent_send' };
      if (/附件|简历/.test(entry.pendingUser || '')) delete entry.pendingUser;
    }
    if (state.attachment === 'send_requested') {
      const intent = { kind: 'attachment', jobId: entry.job.id, filename: RESUME_FILE, status: 'prepared', at: new Date().toISOString() };
      report.intents.push(intent); save();
      progress('send_requested_resume', { company: entry.job.company });
      const receipt = await chat.sendResume(entry.job, RESUME_FILE, history, () => { assertAuthority(); intent.status = 'outcome_unknown'; entry.status = 'outcome_unknown'; entry.pendingWrite = pendingWrite('attachment', history, {filename:RESUME_FILE}); save(); });
      intent.status = 'delivered'; entry.status = 'delivered'; entry.platformAttachment = receipt; delete entry.pendingUser; delete entry.pendingWrite;
      report.receipts.push(receipt); report.result.attachmentsSent++; report.result.messagesSent++; save();
      history = await chat.openConversation(entry.job);
      state = conversationState(history);
    }
    const human = state.human;
    if (!human.length || human.at(-1).self) { delete entry.inboxRetry;save();report.inboxSummary.noNewMessage++; continue; }
    const hash = createHash('sha256').update(JSON.stringify(history.messages) + fs.readFileSync(root + '/candidate-profile.md', 'utf8') + fs.readFileSync(new URL('../../prompts/reply.md', import.meta.url), 'utf8') + fs.readFileSync(new URL('../../prompts/common.md', import.meta.url), 'utf8')).digest('hex');
    // A resume receipt does not answer other questions from HR.
    if (entry.lastHandledHistory === hash) { report.inboxSummary.alreadyHandled++; continue; }
    const decision = await decide(entry.job, history, 'reply');
    if (Date.now() >= deadline) { report.inboxDeferred = true; break; }
    if (decision.action === 'skip') {
      report.inboxSummary.pending++;
      entry.pendingUser = decision.reason; if (!decision.retryable) entry.lastHandledHistory = hash; save();
      raiseAlert(root, { kind: 'hr_pending', contact: entry.job.id, reason: decision.reason });
      continue;
    }
    const intent = { kind: 'reply', jobId: entry.job.id, message: decision.message, at: new Date().toISOString(), status: 'prepared' };
    report.intents.push(intent); save();
    const receipt = await chat.sendText(entry.job, decision.message, history, () => { assertAuthority(); intent.status = 'outcome_unknown'; entry.status = 'outcome_unknown'; entry.pendingWrite = pendingWrite('text', history, {message:decision.message}); save(); });
    intent.status = 'delivered'; entry.status = 'delivered'; entry.lastHandledHistory = hash; delete entry.pendingWrite;
    report.receipts.push(receipt); report.result.messagesSent++; report.result.repliesSent++; save();
    delete entry.inboxRetry;save();
    } catch(error) {
      if(stopAll(error))throw error;
      // Isolate this contact, including ambiguous sends, without aborting another lane.
      deferInbox(root,entry,error);
      report.inboxSummary.processingFailed=(report.inboxSummary.processingFailed||0)+1;
      report.inboxFailures ||= [];
      report.inboxFailures.push({jobId:entry.job.id,reason:error.message,status:entry.status});
      for(const intent of report.intents)if(intent.jobId===entry.job.id&&intent.status==='prepared')intent.status='cancelled';
      save();
    }
  }
  let roundRobinProcessed=0;
  for(const entry of originalEntries) { if(!checkedEntries.has(entry))break; roundRobinProcessed++; }
  atomicJson(inboxPath, { next: eligible.length ? (inbox.next + roundRobinProcessed) % eligible.length : 0 });
}
