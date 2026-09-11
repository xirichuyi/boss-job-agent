import test from "node:test";
import assert from "node:assert/strict";
import {
  pairingChat,
  telegramCall,
} from "../src/adapters/telegram/transport.ts";
const config = {
  pairCode: "123456",
  pairIssuedAt: "2026-09-07T00:00:00Z",
  pairExpiresAt: "2026-09-07T01:00:00Z",
};
const update = {
  message: {
    chat: { id: 42, type: "private" },
    from: { id: 42 },
    text: "绑定求职\n 123456",
    date: Date.parse("2026-09-07T00:10:00Z") / 1000,
  },
};
const now = Date.parse("2026-09-07T00:20:00Z");
test("pairing accepts whitespace but requires private chat and fresh code", () => {
  assert.equal(pairingChat([update], config, now), 42);
  assert.equal(pairingChat([update], config, now + 86400000), null);
  assert.equal(
    pairingChat(
      [{ message: { ...update.message, text: "/start" } }],
      config,
      now,
    ),
    null,
  );
  assert.equal(
    pairingChat(
      [{ message: { ...update.message, chat: { id: 42, type: "group" } } }],
      config,
      now,
    ),
    null,
  );
});
test("network error cannot leak bot token", async () => {
  const result = await telegramCall(
    "SECRET",
    "sendMessage",
    {},
    async (url) => {
      throw Error(url);
    },
  );
  assert.equal(result.code, "network_error");
  assert.ok(!JSON.stringify(result).includes("SECRET"));
});
