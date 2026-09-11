import { ROOT } from "../src/project-root.ts";
import { telegramCall } from "../src/adapters/telegram/transport.ts";
import { harness } from "../src/storage/harness.ts";
import {
  readJson,
  atomicJson,
  ingest,
  snapshot,
  statusText,
  answerQuestion,
} from "../src/adapters/telegram/chat.ts";
const root = ROOT;
const statePath = root + "/memory/telegram-chat-state.json";
const config = readJson(root + "/memory/telegram-config.json");
const { token } = readJson(root + "/memory/telegram-secrets.json");
if (!config?.chatId) throw Error("Telegram尚未绑定");
let state = readJson(statePath, {
  startedAt: new Date().toISOString(),
  offset: 0,
  queue: [],
  history: [],
  summaries: [],
});
const save = () => atomicJson(statePath, state);
save();
const send = (text) =>
  telegramCall(token, "sendMessage", {
    chat_id: config.chatId,
    text,
    link_preview_options: { is_disabled: true },
  });
const help =
  "这里是求职 Agent 查询入口。直接问“现在进度怎么样”或“为什么跳过这个岗位”。\n/status 查状态；/run 提交一轮任务；/help 查看说明。\n不主动播报任务进度，只提醒扫码或人机验证。自然语言聊天不直接修改配置或给HR发消息。";
for (;;) {
  try {
    const updates = await telegramCall(token, "getUpdates", {
      offset: state.offset,
      timeout: 0,
      limit: 50,
      allowed_updates: ["message"],
    });
    if (!updates.ok) {
      console.log(JSON.stringify({ state: "poll_failed", code: updates.code }));
    } else {
      state = ingest(state, updates.result, config.chatId);
      save();
    }
    const item = state.queue.find((q) => q.status !== "sent");
    if (item && !(Date.parse(item.retryAt || "") > Date.now())) {
      if (!item.answer) {
        if (item.text.trim() === "/run") {
          const id = harness().enqueue("telegram", "telegram:" + item.id);
          item.answer = `已提交求职任务 ${id}。由统一调度器领取，不另开浏览器执行器；暂停、维护、每日额度及防重规则仍有效。通常下一次分钟检查处理，当前任务未结束时等待。`;
        } else if (/^(\/status|状态|进度)$/.test(item.text.trim()))
          item.answer = statusText(snapshot(root));
        else if (/^\/(help|start)$/.test(item.text.trim())) item.answer = help;
        else {
          await telegramCall(token, "sendChatAction", {
            chat_id: config.chatId,
            action: "typing",
          });
          item.answer = answerQuestion(root, item.text, state.history);
        }
        item.status = "answered";
        save(); // Persist before sending; retries do not rerun Codex.
      }
      const response = await send(item.answer);
      if (response.ok) {
        item.status = "sent";
        item.messageId = response.result.message_id;
        state.history.push({ user: item.text, assistant: item.answer });
        state.history = state.history.slice(-50);
      } else
        item.retryAt = new Date(
          Date.now() + Math.max(30, response.retryAfter || 60) * 1000,
        ).toISOString();
      save();
    }
    atomicJson(root + "/memory/telegram-chat-health.json", {
      at: new Date().toISOString(),
      state: "running",
      pending: state.queue.filter((q) => q.status !== "sent").length,
    });
  } catch {
    console.log(
      JSON.stringify({ state: "chat_error", at: new Date().toISOString() }),
    );
  }
  await new Promise((r) => setTimeout(r, 3000));
}
