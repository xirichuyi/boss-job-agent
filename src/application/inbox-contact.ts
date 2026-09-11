import { readHistory } from "./history-read.ts";
import { deferInbox, stopAll } from "./inbox-retry.ts";
import { pendingWrite } from "./reconcile.ts";
import { conversationState } from "./conversation-policy.ts";
import type {
  Contact,
  InboxContactContext,
  SendIntent,
} from "../domain/contracts.ts";

// One verified conversation. No batch cursor or scheduler ownership here.
export async function processInboxContact(
  {
    root,
    services,
    report,
    chat,
    decide,
    progress,
    save,
    assertAuthority,
  }: InboxContactContext,
  entry: Contact,
  deadline: number,
): Promise<boolean> {
  const timestamp = () => new Date(services.now()).toISOString();
  const excluded = services.rejectJob(entry.job);
  if (excluded) {
    entry.pendingUser = excluded;
    report.inboxSummary.excluded = (report.inboxSummary.excluded || 0) + 1;
    save();
    return true;
  }
  progress("check_existing_history", { company: entry.job.company });
  let history = await readHistory(chat, entry.job, {
    deadline,
    onRetry: () => {
      report.inboxSummary.readRetried =
        (report.inboxSummary.readRetried || 0) + 1;
    },
  }).catch((error) => {
    report.historyChecks.push({
      jobId: entry.job.id,
      status: "failed",
      reason: error.message,
    });
    entry.historyFailures = (entry.historyFailures || 0) + 1;
    save();
    services.alert({
      kind: "history_read_failed",
      contact: entry.job.id,
      reason: "某已联系HR历史暂时读取失败，轮询会继续重试。",
    });
    if (stopAll(error)) throw error;
    deferInbox(root, entry, error);
    save();
    return null;
  });
  if (!history) {
    report.inboxSummary.readFailed++;
    return true;
  }
  report.inboxSummary.checked++;
  entry.historyFailures = 0;
  report.historyChecks.push({
    jobId: entry.job.id,
    status: "read",
    at: timestamp(),
  });
  save();
  let state = conversationState(history);
  entry.platformCheckedAt = timestamp();
  entry.platformHistory = history; // Current UI is authoritative, including manual activity.
  if (state.receipt) {
    entry.platformAttachment = {
      text: state.receipt.text,
      id: state.receipt.id,
      observedAt: entry.platformCheckedAt,
      source: "platform_observed_not_counted_as_agent_send",
    };
    if (/附件|简历/.test(entry.pendingUser || "")) delete entry.pendingUser;
  }
  if (state.attachment === "send_requested") {
    const intent: SendIntent = {
      kind: "attachment",
      jobId: entry.job.id,
      filename: services.resumeFile,
      status: "prepared",
      at: timestamp(),
    };
    report.intents.push(intent);
    save();
    progress("send_requested_resume", { company: entry.job.company });
    const receipt = await chat.sendResume(
      entry.job,
      services.resumeFile,
      history,
      () => {
        assertAuthority();
        intent.status = "outcome_unknown";
        entry.status = "outcome_unknown";
        entry.pendingWrite = pendingWrite("attachment", history, {
          filename: services.resumeFile,
        });
        save();
      },
    );
    intent.status = "delivered";
    entry.status = "delivered";
    entry.platformAttachment = receipt;
    delete entry.pendingUser;
    delete entry.pendingWrite;
    report.receipts.push(receipt);
    report.result.attachmentsSent++;
    report.result.messagesSent++;
    save();
    history = await chat.openConversation(entry.job);
    state = conversationState(history);
  }
  const human = state.human;
  if (!human.length || human.at(-1).self) {
    delete entry.inboxRetry;
    delete entry.replyDraft;
    delete entry.replyDeferredAt;
    save();
    report.inboxSummary.noNewMessage++;
    return true;
  }
  const hash = services.fingerprint(history);
  // A resume receipt does not answer other questions from HR.
  if (entry.lastHandledHistory === hash) {
    report.inboxSummary.alreadyHandled++;
    return true;
  }
  // Reuse only against the same fresh platform history/profile/prompt fingerprint.
  const cached =
    entry.replyDraft?.historyHash === hash ? entry.replyDraft : null;
  if (entry.replyDraft && !cached) {
    delete entry.replyDraft;
    save();
  }
  const decision =
    cached?.decision || (await decide(entry.job, history, "reply"));
  entry.lastReplyDecision = {
    action: decision.action,
    reason: decision.reason || null,
    retryable: !!decision.retryable,
    at: timestamp(),
  };
  if (decision.action === "reply")
    entry.replyDraft = {
      historyHash: hash,
      decision,
      createdAt: cached?.createdAt || timestamp(),
    };
  save();
  if (services.now() >= deadline) {
    report.inboxDeferred = true;
    entry.replyDeferredAt = timestamp();
    save();
    return false;
  }
  if (decision.action === "skip") {
    report.inboxSummary.pending++;
    entry.pendingUser = decision.reason;
    if (!decision.retryable) entry.lastHandledHistory = hash;
    save();
    services.alert({
      kind: "hr_pending",
      contact: entry.job.id,
      reason: decision.reason,
    });
    return true;
  }
  const intent: SendIntent = {
    kind: "reply",
    jobId: entry.job.id,
    message: decision.message,
    at: timestamp(),
    status: "prepared",
  };
  report.intents.push(intent);
  save();
  const receipt = await chat.sendText(
    entry.job,
    decision.message,
    history,
    () => {
      assertAuthority();
      intent.status = "outcome_unknown";
      entry.status = "outcome_unknown";
      entry.pendingWrite = pendingWrite("text", history, {
        message: decision.message,
      });
      save();
    },
  );
  intent.status = "delivered";
  entry.status = "delivered";
  entry.lastHandledHistory = hash;
  delete entry.pendingWrite;
  delete entry.replyDraft;
  delete entry.replyDeferredAt;
  delete entry.pendingUser;
  report.receipts.push(receipt);
  report.result.messagesSent++;
  report.result.repliesSent++;
  save();
  delete entry.inboxRetry;
  save();
  return true;
}
