import { readState } from "../storage/harness.ts";
import { executionConfig } from "../runtime/coordinator.ts";
import { raiseAlert, resolveContactAlerts } from "../storage/alerts.ts";
import { rejectJobFilters } from "../config/job-filters.ts";
import { classifyFailure } from "../domain/recovery.ts";

export function deferContact(root, entry, error, save) {
  const config = executionConfig().contactRecovery;
  const previous = entry.contactRecovery || {};
  const attempts = (previous.attempts || 0) + 1;
  entry.contactRecovery = {
    ...previous,
    attempts,
    state: attempts >= config.maxAttempts ? "manual_required" : "pending",
    lastError: error.message,
    lastAttemptAt: new Date().toISOString(),
    nextAt: new Date(Date.now() + config.retryMinutes * 60000).toISOString(),
  };
  entry.status = "quarantined";
  save();
  raiseAlert(root, {
    kind: "contact_recovery_pending",
    contact: entry.job.id,
    company: entry.job.company,
    stage: entry.deliveryStage || "lookup",
    reason: error.message,
    nextAt: entry.contactRecovery.nextAt,
    attempts,
  });
  if (entry.contactRecovery.state === "manual_required")
    raiseAlert(root, {
      kind: "contact_recovery_exhausted",
      reason:
        "有联系人自动恢复已达重试上限，需要核实；其他岗位继续运行。详情见联系恢复记录。",
    });
}

export function onlyDefaultGreeting(history) {
  const human = history.messages.filter(
    (m) => !m.system && !/^你与该职位竞争者/.test(m.text),
  );
  return (
    human.length === 1 &&
    human[0].self &&
    /送达|已读/.test(human[0].text) &&
    /您好，我是[\s\S]*可以和您进一步沟通[\s\S]*职位吗[？?]/.test(human[0].text)
  );
}

export async function recoverContacts({
  root,
  ledger,
  report,
  chat,
  save,
  assertAuthority,
  deadline = Infinity,
}) {
  const config = executionConfig().contactRecovery;
  report.contactRecovery = { checked: 0, completed: 0, deferred: 0, manual: 0 };
  const entries = ledger.contacts.filter((e) => {
    if (
      !["quarantined", "outcome_unknown"].includes(e.status) ||
      e.intent?.kind !== "first_contact"
    )
      return false;
    if (e.deliveryStage || e.contactRecovery) return true;
    const old = readState(root + "/memory/cycles/" + e.cycle + ".json", {});
    return (
      old.reason === "联系人暂未找到，留待下轮，不盲等" &&
      !(old.intents || []).some(
        (i) => i.jobId === e.job.id && i.kind === "targeted_message",
      )
    );
  });
  for (const entry of entries
    .slice()
    .sort((a, b) =>
      (a.contactRecovery?.lastAttemptAt || "").localeCompare(
        b.contactRecovery?.lastAttemptAt || "",
      ),
    )) {
    if (
      Date.now() >= deadline ||
      report.contactRecovery.checked >= config.perRun
    )
      break;
    if (
      entry.contactRecovery?.state === "manual_required" ||
      Date.parse(entry.contactRecovery?.nextAt || "") > Date.now()
    )
      continue;
    report.contactRecovery.checked++;
    try {
      const source = readState(
        root + "/memory/cycles/" + entry.cycle + ".json",
        {},
      );
      const supplements = (source.intents || []).filter(
        (i) => i.jobId === entry.job.id && i.kind === "targeted_message",
      );
      // Old runs are eligible only when the durable log proves sendText was never reached.
      const neverAttempted =
        entry.deliveryStage === "lookup_pending" ||
        (!entry.deliveryStage &&
          source.reason === "联系人暂未找到，留待下轮，不盲等" &&
          supplements.length === 0);
      const history = await chat.openConversation(entry.job);
      const matching = history.messages.filter(
        (m) =>
          m.self &&
          /送达|已读/.test(m.text) &&
          m.text
            .trim()
            .replace(/^(?:\d{1,2}:\d{2}\s*)?(?:送达|已读)\s*/, "") ===
            entry.intent.message.trim(),
      );
      if (matching.length === 1) {
        entry.status = "delivered";
        entry.contactRecovery = {
          state: "completed",
          source: "platform_observed",
          at: new Date().toISOString(),
        };
        report.contactRecovery.completed++;
        save();
        resolveContactAlerts(root, entry.job.id);
        continue;
      }
      if (!neverAttempted)
        throw Error("发送曾进入执行阶段或缺少可靠基线，禁止自动重发");
      if (!onlyDefaultGreeting(history)) {
        // Leave a genuine response/manual message for normal inbox handling.
        if (
          history.messages.some(
            (m) => !m.self && !m.system && !/^你与该职位竞争者/.test(m.text),
          )
        ) {
          entry.status = "delivered";
          entry.contactRecovery = {
            state: "completed",
            source: "handed_to_inbox",
            at: new Date().toISOString(),
          };
          report.contactRecovery.completed++;
          save();
          resolveContactAlerts(root, entry.job.id);
          continue;
        }
        throw Error("聊天并非只有唯一默认招呼，需核实，不补发");
      }
      const rejection = rejectJobFilters(entry.job);
      if (rejection) throw Error(rejection);
      if (Date.now() >= deadline) break;
      const intent = {
        kind: "targeted_message",
        jobId: entry.job.id,
        message: entry.intent.message,
        status: "prepared",
        recoveryOf: entry.cycle,
      };
      report.intents.push(intent);
      save();
      const receipt = await chat.sendText(
        entry.job,
        entry.intent.message,
        history,
        () => {
          assertAuthority();
          entry.deliveryStage = "supplement_attempted";
          intent.status = "outcome_unknown";
          entry.pendingWrite = {
            kind: "text",
            message: entry.intent.message,
            beforeIds: history.messages.map((m) => m.id),
            at: new Date().toISOString(),
          };
          save();
        },
      );
      intent.status = "delivered";
      entry.status = "delivered";
      entry.deliveryStage = "complete";
      entry.receipt = receipt;
      entry.contactRecovery = {
        state: "completed",
        at: new Date().toISOString(),
      };
      delete entry.pendingWrite;
      report.receipts.push(receipt);
      report.result.messagesSent++;
      report.contactRecovery.completed++;
      save();
      resolveContactAlerts(root, entry.job.id);
    } catch (error) {
      if (["TASK_PAUSED", "LEASE_LOST"].includes(error.code)) throw error;
      if (classifyFailure(error.message) === "authentication") throw error;
      deferContact(root, entry, error, save);
      report.contactRecovery.deferred++;
      if (entry.contactRecovery.state === "manual_required")
        report.contactRecovery.manual++;
    }
  }
}
