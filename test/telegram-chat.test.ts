import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizedMessage,
  ingest,
  statusText,
} from "../src/adapters/telegram/chat.ts";
const since = "2026-09-08T00:00:00Z";
const message = {
  update_id: 10,
  message: {
    chat: { type: "private", id: 42 },
    from: { id: 42 },
    date: Date.parse(since) / 1000 + 1,
    text: "进度",
  },
};
test("chat accepts only bound private sender after activation", () => {
  assert.equal(authorizedMessage(message, 42, since), true);
  assert.equal(authorizedMessage(message, 43, since), false);
  assert.equal(
    authorizedMessage(
      { ...message, message: { ...message.message, from: { id: 5 } } },
      42,
      since,
    ),
    false,
  );
  assert.equal(
    authorizedMessage(
      {
        ...message,
        message: { ...message.message, chat: { type: "group", id: 42 } },
      },
      42,
      since,
    ),
    false,
  );
  assert.equal(authorizedMessage(message, 42, "2026-09-09T00:00:00Z"), false);
});
test("queue and offset survive duplicate updates; outsiders never queued", () => {
  const state = { startedAt: since, offset: 0, queue: [] };
  ingest(
    state,
    [
      message,
      {
        ...message,
        update_id: 11,
        message: { ...message.message, from: { id: 9 } },
      },
    ],
    42,
  );
  ingest(state, [message], 42);
  assert.equal(state.offset, 12);
  assert.equal(state.queue.length, 1);
  assert.equal(state.queue[0].text, "进度");
});
test("status distinguishes new HR, messages and attachments", () => {
  const text = statusText({
    status: { state: "waiting" },
    cycle: {
      status: "completed",
      result: { newContacts: 1, messagesSent: 2, attachmentsSent: 0 },
    },
    capturedAt: since,
  });
  assert.match(text, /新联系 1 人/);
  assert.match(text, /消息 2 条/);
  assert.match(text, /附件 0 份/);
});
test("status exposes business failures even when scheduler remains active", () => {
  const text = statusText({
    status: { state: "waiting" },
    cycle: { status: "completed" },
    business: {
      state: "degraded",
      failureStreak: 3,
      reasons: ["会话历史持续读取失败"],
    },
  });
  assert.match(text, /连续失败，需要检查/);
  assert.match(text, /连续异常 3 轮/);
});
