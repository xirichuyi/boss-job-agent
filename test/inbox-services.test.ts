import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { replyFingerprint } from "../src/domain/reply-fingerprint.ts";
import { processInboxContact } from "../src/application/inbox-contact.ts";

test("reply fingerprint preserves old keys and invalidates every context input", () => {
  const history = { messages: [{ text: "项目介绍", self: false }] };
  const original = replyFingerprint(history, "profile", "reply", "common");
  assert.equal(
    original,
    createHash("sha256")
      .update(JSON.stringify(history.messages) + "profile" + "reply" + "common")
      .digest("hex"),
  );
  for (const changed of [
    replyFingerprint({ messages: [] }, "profile", "reply", "common"),
    replyFingerprint(history, "changed", "reply", "common"),
    replyFingerprint(history, "profile", "changed", "common"),
    replyFingerprint(history, "profile", "reply", "changed"),
  ])
    assert.notEqual(changed, original);
});

test("contact uses injected resources and clock, persists draft before deadline exit", async () => {
  const entry = { job: { id: "a", company: "example" }, status: "delivered" };
  const report = {
    historyChecks: [],
    intents: [],
    receipts: [],
    inboxSummary: { checked: 0 },
    result: {},
  };
  let writes = 0;
  const context = {
    root: "/nonexistent-inbox-test-root",
    report,
    services: {
      now: () => 1000,
      resumeFile: "configured.pdf",
      rejectJob: () => null,
      fingerprint: () => "injected-key",
      alert: () => assert.fail("no alert expected"),
    },
    chat: {
      openConversation: async () => ({
        messages: [{ text: "介绍项目", self: false }],
      }),
      sendText: async () => assert.fail("expired deadline must not send"),
      sendResume: async () => assert.fail("no resume request"),
    },
    decide: async () => ({ action: "reply", message: "我做过网关开发。" }),
    progress() {},
    save() {
      writes++;
    },
    assertAuthority() {},
  };
  assert.equal(await processInboxContact(context, entry, 1000), false);
  assert.equal(entry.replyDraft.historyHash, "injected-key");
  assert.equal(entry.replyDraft.createdAt, new Date(1000).toISOString());
  assert.equal(report.inboxDeferred, true);
  assert.equal(report.intents.length, 0);
  assert.ok(writes > 0);
});
