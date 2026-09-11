import { deferInbox, stopAll } from "./inbox-retry.ts";
import { AGENT } from "../config/agent.ts";
import { loadJobFilters } from "../config/job-filters.ts";
import { readState } from "../storage/harness.ts";
import { atomicJson } from "../storage/state.ts";
import { selectInboxBatch, classifyFailure } from "../domain/recovery.ts";
import { processInboxContact } from "./inbox-contact.ts";
import { createInboxServices } from "../runtime/inbox-services.ts";
export async function checkInbox({
  root,
  ledger,
  report,
  chat,
  decide,
  progress,
  save,
  assertAuthority,
  deadline = Infinity,
  services = createInboxServices(root),
}) {
  // Existing verified contacts only. No responding to unknown-company inboxes.
  const inboxPath = root + "/memory/inbox-cursor.json";
  const inbox = readState(inboxPath, { next: 0 });
  const eligible = ledger.contacts.filter((e) => e.status === "delivered");
  let unreadEntries = [];
  let visibleRows = [];
  if (chat.scanConversations && Date.now() < deadline) {
    try {
      const discovery = await chat.scanConversations({
        deadline: Math.min(
          deadline,
          Date.now() + loadJobFilters().conversationLookupMs,
        ),
      });
      const matches = (row, e) =>
        row.recruiter === e.job.recruiter && row.label.includes(e.job.company);
      const unread = discovery.rows.filter((r) => r.unread);
      visibleRows = discovery.rows;
      unreadEntries = eligible.filter((e) => unread.some((r) => matches(r, e)));
      const unverified = unread.filter(
        (r) => !ledger.contacts.some((e) => matches(r, e)),
      );
      report.inboxDiscovery = {
        scanned: discovery.rows.length,
        unread: unread.length,
        unverified: unverified.length,
        reachedRenderedEnd: discovery.complete,
      };
      atomicJson(root + "/memory/inbox-discovery.json", {
        capturedAt: new Date().toISOString(),
        ...report.inboxDiscovery,
        unverified,
        action: "未核实身份和岗位的联系人不自动发送，保留待核实记录",
      });
    } catch (error) {
      if (classifyFailure(error.message) === "authentication") throw error;
      report.inboxDiscovery = { error: error.message };
    }
  }
  const batch = selectInboxBatch(
    ledger.contacts,
    inbox.next,
    AGENT.workflow.inboxContactsPerRun,
  );
  // Prioritize all known unread contacts, including those outside the cursor slice.
  const visibleEntries = batch.entries.filter((e) =>
    visibleRows.some(
      (r) => r.recruiter === e.job.recruiter && r.label.includes(e.job.company),
    ),
  );
  const drafts = eligible
    .filter((e) => e.replyDraft)
    .sort((a, b) =>
      (a.replyDraft.createdAt || "").localeCompare(
        b.replyDraft.createdAt || "",
      ),
    );
  const ordered = [
    ...new Set([
      ...unreadEntries,
      ...drafts,
      ...visibleEntries,
      ...batch.entries,
    ]),
  ];
  const originalEntries = batch.entries;
  batch.entries = ordered;
  const checkedEntries = new Set();
  let processed = 0;
  report.historyChecks = [];
  report.inboxSummary = {
    checked: 0,
    noNewMessage: 0,
    alreadyHandled: 0,
    pending: 0,
    readFailed: 0,
  };
  for (const entry of batch.entries) {
    if (Date.now() >= deadline) {
      report.inboxDeferred = true;
      break;
    }
    processed++;
    checkedEntries.add(entry);
    if (Date.parse(entry.inboxRetry?.nextAt || "") > Date.now()) {
      report.inboxSummary.retryDeferred =
        (report.inboxSummary.retryDeferred || 0) + 1;
      continue;
    }
    try {
      if (
        !(await processInboxContact(
          {
            root,
            report,
            chat,
            decide,
            progress,
            save,
            assertAuthority,
            services,
          },
          entry,
          deadline,
        ))
      )
        break;
    } catch (error) {
      if (stopAll(error)) throw error;
      // Isolate this contact, including ambiguous sends, without aborting another lane.
      deferInbox(root, entry, error);
      report.inboxSummary.processingFailed =
        (report.inboxSummary.processingFailed || 0) + 1;
      report.inboxFailures ||= [];
      report.inboxFailures.push({
        jobId: entry.job.id,
        reason: error.message,
        status: entry.status,
      });
      for (const intent of report.intents)
        if (intent.jobId === entry.job.id && intent.status === "prepared")
          intent.status = "cancelled";
      save();
    }
  }
  let roundRobinProcessed = 0;
  for (const entry of originalEntries) {
    if (!checkedEntries.has(entry)) break;
    roundRobinProcessed++;
  }
  atomicJson(inboxPath, {
    next: eligible.length
      ? (inbox.next + roundRobinProcessed) % eligible.length
      : 0,
  });
}
