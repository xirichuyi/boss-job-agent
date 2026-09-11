import fs from "node:fs";
import { readHistory } from "./history-read.ts";
import { deferInbox, stopAll } from "./inbox-retry.ts";
import { pendingWrite } from "./reconcile.ts";
import { rejectJobFilters } from "../config/job-filters.ts";
import { createHash } from "node:crypto";
import { raiseAlert } from "../storage/alerts.ts";
import { conversationState, RESUME_FILE } from "./conversation-policy.ts";
import type {
  Contact,
  InboxContactContext,
  SendIntent,
} from "../domain/contracts.ts";

// One verified conversation. No batch cursor or scheduler ownership here.
export async function processInboxContact(
  {
    root,
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
  const excluded = rejectJobFilters(entry.job);
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
    raiseAlert(root, {
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
    at: new Date().toISOString(),
  });
  save();
  let state = conversationState(history);
  entry.platformCheckedAt = new Date().toISOString();
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
      filename: RESUME_FILE,
      status: "prepared",
      at: new Date().toISOString(),
    };
    report.intents.push(intent);
    save();
    progress("send_requested_resume", { company: entry.job.company });
    const receipt = await chat.sendResume(
      entry.job,
      RESUME_FILE,
      history,
      () => {
        assertAuthority();
        intent.status = "outcome_unknown";
        entry.status = "outcome_unknown";
        entry.pendingWrite = pendingWrite("attachment", history, {
          filename: RESUME_FILE,
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
  const hash = createHash("sha256")
    .update(
      JSON.stringify(history.messages) +
        fs.readFileSync(root + "/candidate-profile.md", "utf8") +
        fs.readFileSync(
          new URL("../../prompts/reply.md", import.meta.url),
          "utf8",
        ) +
        fs.readFileSync(
          new URL("../../prompts/common.md", import.meta.url),
          "utf8",
        ),
    )
    .digest("hex");
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
    at: new Date().toISOString(),
  };
  if (decision.action === "reply")
    entry.replyDraft = {
      historyHash: hash,
      decision,
      createdAt: cached?.createdAt || new Date().toISOString(),
    };
  save();
  if (Date.now() >= deadline) {
    report.inboxDeferred = true;
    entry.replyDeferredAt = new Date().toISOString();
    save();
    return false;
  }
  if (decision.action === "skip") {
    report.inboxSummary.pending++;
    entry.pendingUser = decision.reason;
    if (!decision.retryable) entry.lastHandledHistory = hash;
    save();
    raiseAlert(root, {
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
    at: new Date().toISOString(),
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
