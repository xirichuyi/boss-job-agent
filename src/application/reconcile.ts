import { AGENT } from "../config/agent.ts";
import { classifyFailure } from "../domain/recovery.ts";

export function pendingWrite(kind, before, extra = {}) {
  return {
    kind,
    ...extra,
    beforeIds: before.messages.map((m) => m.id),
    at: new Date().toISOString(),
  };
}

export function observedReceipt(pending, history) {
  if (
    !pending ||
    !Array.isArray(pending.beforeIds) ||
    pending.beforeIds.some((id) => !id)
  )
    return null;
  const fresh = history.messages.filter(
    (m) => m.id && !pending.beforeIds.includes(m.id),
  );
  const matches = fresh.filter((m) => {
    if (pending.kind === "attachment")
      return (
        m.system &&
        m.text.includes(pending.filename) &&
        /您的附件简历[\s\S]*已发送给Boss/.test(m.text)
      );
    if (!m.self || m.system || !pending.message) return false;
    // Exact body after known delivery UI prefix; no substring/fuzzy matching.
    const body = m.text
      .trim()
      .replace(/^(?:\d{1,2}:\d{2}\s*)?(?:送达|已读)\s*/, "");
    return body !== m.text.trim() && body === pending.message.trim();
  });
  return matches.length === 1
    ? {
        id: matches[0].id,
        text: matches[0].text,
        observedAt: new Date().toISOString(),
        source: "platform_observed_not_attributed_to_agent",
      }
    : null;
}

export async function reconcileUnknown({
  ledger,
  report,
  chat,
  save,
  deadline = Infinity,
}) {
  const entries = ledger.contacts.filter((e) =>
    ["quarantined", "outcome_unknown"].includes(e.status),
  );
  entries.sort((a, b) =>
    (a.reconciledAt || "").localeCompare(b.reconciledAt || ""),
  );
  report.reconciliation = { checked: 0, restored: 0, unresolved: 0 };
  for (const entry of entries.slice(0, AGENT.workflow.reconcilePerRun)) {
    if (Date.now() >= deadline) break;
    entry.reconciledAt = new Date().toISOString();
    report.reconciliation.checked++;
    try {
      const receipt = entry.pendingWrite
        ? observedReceipt(
            entry.pendingWrite,
            await chat.openConversation(entry.job),
          )
        : null;
      if (receipt) {
        entry.reconciliation = {
          receipt,
          previousStatus: entry.status,
          pending: entry.pendingWrite,
        };
        entry.status = "delivered";
        delete entry.pendingWrite;
        report.reconciliation.restored++;
      } else report.reconciliation.unresolved++;
    } catch (error) {
      entry.reconciliationError = error.message;
      report.reconciliation.unresolved++;
      if (classifyFailure(error.message) === "authentication") {
        save();
        throw error;
      }
    }
    // Never resend, refund quota, or relabel historical counts based on observation.
    save();
  }
}
