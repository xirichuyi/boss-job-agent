import fs from 'node:fs';
import { rejectJobFilters } from '../job-filters.js';
import { AGENT } from '../agent-config.js';
import { createHash } from 'node:crypto';
import { readState } from '../harness-store.js';
import { atomicJson } from '../schedule-state.js';
import { selectInboxBatch, classifyFailure } from '../autonomy.js';
import { raiseAlert } from '../alerts.js';
import { conversationState, RESUME_FILE } from './conversation-policy.js';
import { pendingWrite } from './reconcile.js';
export async function checkInbox({root, ledger, report, chat, decide, progress, save, assertAuthority, deadline = Infinity}) {
  // Discover unread rows, but only send to identity/JD-verified ledger contacts.
  const inboxPath = root + '/memory/inbox-cursor.json';
  const inbox = readState(inboxPath, { next: 0 });
  const batch = selectInboxBatch(ledger.contacts, inbox.next, AGENT.workflow.inboxContactsPerRun);
  if (chat.scanConversations && Date.now() < deadline) {
    try {
      const discovery = await chat.scanConversations({deadline});
      const matches = (row, entry) => row.recruiter === entry.job.recruiter && row.label.includes(entry.job.company);
      const unread = discovery.rows.filter(r => r.unread);
      batch.entries.sort((a,b) => Number(unread.some(r=>matches(r,b))) - Number(unread.some(r=>matches(r,a))));
      const unverified = unread.filter(row => !ledger.contacts.some(e => matches(row,e)));
      report.inboxDiscovery = { scanned: discovery.rows.length, unread: unread.length, unverified: unverified.length, reachedRenderedEnd: discovery.complete };
      atomicJson(root + '/memory/inbox-discovery.json', { capturedAt:new Date().toISOString(), ...report.inboxDiscovery, unverified, action:'需核实联系人身份、JD和求职条件后才能纳入自动回复；本次未发送' });
    } catch (error) {
      if (classifyFailure(error.message) === 'authentication') throw error;
      report.inboxDiscovery = { error:error.message };
    }
  }
  let processed = 0;
  report.historyChecks = [];
  report.inboxSummary = { checked: 0, noNewMessage: 0, alreadyHandled: 0, pending: 0, readFailed: 0 };
  for (const entry of batch.entries) {
    if (Date.now() >= deadline) { report.inboxDeferred = true; break; }
    processed++;
    const excluded = rejectJobFilters(entry.job);
    if (excluded) { entry.pendingUser = excluded; report.inboxSummary.excluded = (report.inboxSummary.excluded || 0) + 1; save(); continue; }
    progress('check_existing_history', { company: entry.job.company });
    const history = await chat.openConversation(entry.job).catch(error => {
      report.historyChecks.push({ jobId: entry.job.id, status: 'failed', reason: error.message });
      entry.historyFailures = (entry.historyFailures || 0) + 1; save();
      raiseAlert(root, { kind: 'history_read_failed', contact: entry.job.id, reason: '某已联系HR历史暂时读取失败，轮询会继续重试。' });
      if (classifyFailure(error.message) === 'authentication') throw error;
      return null;
    });
    if (!history) { report.inboxSummary.readFailed++; continue; }
    report.inboxSummary.checked++;
    entry.historyFailures = 0;
    report.historyChecks.push({ jobId: entry.job.id, status: 'read', at: new Date().toISOString() }); save();
    const state = conversationState(history);
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
      const receipt = await chat.sendResume(entry.job, RESUME_FILE, history, () => { assertAuthority(); intent.status = 'outcome_unknown'; entry.status = 'outcome_unknown'; entry.pendingWrite = pendingWrite('attachment', history, { filename: RESUME_FILE }); save(); });
      intent.status = 'delivered'; entry.status = 'delivered'; entry.platformAttachment = receipt; delete entry.pendingUser; delete entry.pendingWrite;
      report.receipts.push(receipt); report.result.attachmentsSent++; report.result.messagesSent++; save();
      continue;
    }
    const human = state.human;
    if (!human.length || human.at(-1).self) { report.inboxSummary.noNewMessage++; continue; }
    const hash = createHash('sha256').update(JSON.stringify(history.messages) + fs.readFileSync(root + '/candidate-profile.md', 'utf8')).digest('hex');
    if (state.attachment === 'already_sent' && state.requested) { entry.lastHandledHistory = hash; save(); continue; }
    if (entry.lastHandledHistory === hash) { report.inboxSummary.alreadyHandled++; continue; }
    const decision = decide(entry.job, history, 'reply');
    if (decision.action === 'skip') {
      report.inboxSummary.pending++;
      entry.pendingUser = decision.reason; if (!decision.retryable) entry.lastHandledHistory = hash; save();
      raiseAlert(root, { kind: 'hr_pending', contact: entry.job.id, reason: decision.reason });
      continue;
    }
    const intent = { kind: 'reply', jobId: entry.job.id, message: decision.message, at: new Date().toISOString(), status: 'prepared' };
    report.intents.push(intent); save();
    const receipt = await chat.sendText(entry.job, decision.message, history, () => { assertAuthority(); intent.status = 'outcome_unknown'; entry.status = 'outcome_unknown'; entry.pendingWrite = pendingWrite('text', history, { message: decision.message }); save(); });
    intent.status = 'delivered'; entry.status = 'delivered'; entry.lastHandledHistory = hash; delete entry.pendingWrite;
    report.receipts.push(receipt); report.result.messagesSent++; report.result.repliesSent++; save();
  }
  const eligible = ledger.contacts.filter(e => e.status === 'delivered').length;
  atomicJson(inboxPath, { next: eligible ? (inbox.next + processed) % eligible : 0 });
}
