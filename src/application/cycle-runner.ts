import { AGENT } from "../config/agent.ts";
import {
  PriorityMutex,
  coordinatedChat,
  runParallelLanes,
  executionConfig,
} from "../runtime/coordinator.ts";
import { checkInbox } from "./inbox.ts";
import { recoverContacts } from "./contact-recovery.ts";
import { reconcileUnknown } from "./reconcile.ts";
import { searchJobs, nextSearchPage } from "./search.ts";
import { contactJobs } from "./outreach.ts";
import { classifyFailure } from "../domain/recovery.ts";

// Business orchestration only. The CLI owns lease checks, persistence and CDP lifetime.
export async function runWorkflows(context, { checkRunning, onFailure }) {
  const { report, chat, jobs, save, cycle } = context;
  await chat.connectView("chat");
  const chatMutex = new PriorityMutex();
  const outreachChat = coordinatedChat(chat, chatMutex, 0, checkRunning);
  const inboxChat = coordinatedChat(chat, chatMutex, 1, checkRunning);
  const searchContext = {
    ...context,
    chat: outreachChat,
    withChat: (task) =>
      chatMutex.run(() => {
        checkRunning();
        return task();
      }, 0),
  };
  report.lanes = {};
  const lane = (name, run) => async () => {
    report.lanes[name] = {
      state: "running",
      startedAt: new Date().toISOString(),
    };
    save();
    try {
      await run();
      report.lanes[name].state = "completed";
    } catch (error) {
      report.lanes[name].state = "blocked";
      report.lanes[name].reason = error.message;
      throw error;
    } finally {
      report.lanes[name].completedAt = new Date().toISOString();
      save();
    }
  };
  await runParallelLanes(
    {
      inbox: lane("inbox", async () => {
        await recoverContacts({
          ...context,
          chat: inboxChat,
          deadline:
            Date.now() + executionConfig().contactRecovery.minutes * 60000,
        });
        const replyDeadline = Date.now() + AGENT.workflow.replyMinutes * 60000;
        await reconcileUnknown({
          ...context,
          chat: inboxChat,
          deadline: replyDeadline,
        });
        await checkInbox({
          ...context,
          chat: inboxChat,
          deadline: replyDeadline,
        });
      }),
      search: lane("search", async () => {
        await jobs.connectView("jobs");
        try {
          const searchDeadline =
            Date.now() + AGENT.workflow.searchMinutes * 60000;
          for (
            let batch = 0;
            batch < AGENT.workflow.searchBatches && Date.now() < searchDeadline;
            batch++
          ) {
            let list = await searchJobs(searchContext);
            for (
              let page = 1;
              page <= AGENT.workflow.searchPages && list.length;
              page++
            ) {
              await contactJobs({
                ...searchContext,
                list,
                deadline: searchDeadline,
              });
              if (
                report.result.newContacts >= cycle.newContactAllocation ||
                Date.now() >= searchDeadline ||
                page === AGENT.workflow.searchPages
              )
                break;
              list = await nextSearchPage(searchContext, page + 1);
            }
            if (report.result.newContacts >= cycle.newContactAllocation) break;
          }
        } catch (error) {
          if (error.code === "MODEL_COOLDOWN") throw error;
          if (
            classifyFailure(error.message) !== "transient" ||
            report.intents.some(
              (i) =>
                !["delivered", "platform_greeting_delivered"].includes(
                  i.status,
                ),
            )
          )
            throw error;
          report.searchWarning = error.message;
          save(); // Read-only search failure must not starve replies.
        }
      }),
    },
    onFailure,
    executionConfig().parallelWorkflows,
  );
}
