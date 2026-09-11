import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  recoverContacts,
  onlyDefaultGreeting,
} from "../src/application/contact-recovery.ts";
import { VisibleTools } from "../src/adapters/browser/visible.ts";

const greeting = {
  id: "g",
  self: true,
  system: false,
  text: "送达\n您好，我是本科生，可以和您进一步沟通开发职位吗？",
};
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-recovery-"));
  fs.mkdirSync(root + "/memory/cycles", { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entry = {
    status: "quarantined",
    cycle: "old",
    deliveryStage: "lookup_pending",
    intent: { kind: "first_contact", message: "我做过网关开发。" },
    job: { id: "j", company: "公司", recruiter: "HR", salary: "11-20K" },
  };
  const report = { intents: [], receipts: [], result: { messagesSent: 0 } };
  return {
    root,
    entry,
    report,
    ledger: { contacts: [entry] },
    save() {},
    assertAuthority() {},
  };
}
test("supplement is recovered once, without clicking first contact or counting another HR", async (t) => {
  const c = fixture(t);
  let sends = 0;
  c.chat = {
    openConversation: async () => ({ messages: [greeting] }),
    sendText: async (j, m, h, p) => {
      p();
      sends++;
      return { text: "送达\n" + m };
    },
  };
  await recoverContacts(c);
  await recoverContacts(c);
  assert.equal(sends, 1);
  assert.equal(c.entry.status, "delivered");
  assert.equal(c.report.result.messagesSent, 1);
});
test("an attempted send is never retried when receipt is unknown", async (t) => {
  const c = fixture(t);
  c.entry.deliveryStage = "supplement_attempted";
  c.chat = {
    openConversation: async () => ({ messages: [greeting] }),
    sendText: () => assert.fail("no resend"),
  };
  await recoverContacts(c);
  assert.equal(c.entry.status, "quarantined");
  assert.equal(c.entry.contactRecovery.attempts, 1);
});
test("existing exact delivered supplement is observed without another send", async (t) => {
  const c = fixture(t);
  c.entry.deliveryStage = "supplement_attempted";
  c.chat = {
    openConversation: async () => ({
      messages: [
        greeting,
        { id: "s", self: true, text: "22:58\n送达\n" + c.entry.intent.message },
      ],
    }),
    sendText: () => assert.fail("duplicate"),
  };
  await recoverContacts(c);
  assert.equal(c.entry.status, "delivered");
  assert.equal(c.report.result.messagesSent, 0);
});
test("one missing contact does not prevent recovery of the next contact", async (t) => {
  const c = fixture(t),
    next = structuredClone(c.entry);
  next.job.id = "next";
  c.ledger.contacts.push(next);
  c.chat = {
    openConversation: async (j) => {
      if (j.id === "j") throw Error("lookup failed");
      return { messages: [greeting] };
    },
    sendText: async (j, m, h, p) => {
      p();
      return { text: m };
    },
  };
  await recoverContacts(c);
  assert.equal(next.status, "delivered");
  assert.equal(c.entry.contactRecovery.state, "pending");
});
test("three failed attempts escalate, and a fourth does not run", async (t) => {
  const c = fixture(t);
  let reads = 0;
  c.chat = {
    openConversation: async () => {
      reads++;
      throw Error("lookup failed");
    },
  };
  for (let i = 0; i < 4; i++) {
    if (c.entry.contactRecovery) c.entry.contactRecovery.nextAt = null;
    await recoverContacts(c);
  }
  assert.equal(reads, 3);
  assert.equal(c.entry.contactRecovery.state, "manual_required");
  assert.ok(
    JSON.parse(fs.readFileSync(c.root + "/memory/alerts.json")).some(
      (a) => a.kind === "contact_recovery_exhausted",
    ),
  );
});
test("manual messages and HR replies are not mistaken for a lone default greeting", () => {
  assert.equal(onlyDefaultGreeting({ messages: [greeting] }), true);
  assert.equal(
    onlyDefaultGreeting({
      messages: [greeting, { self: false, text: "发简历" }],
    }),
    false,
  );
  assert.equal(
    onlyDefaultGreeting({
      messages: [{ self: true, text: "送达\n我手动发的消息" }],
    }),
    false,
  );
});
test("contact search fallback verifies name and company and avoids list scrolling on success", async () => {
  const b = new VisibleTools();
  b.clearSearch = async () => {};
  b.searchHistory = async () => ({ empty: false });
  b.evaluate = async (e) => {
    new Function("return " + e);
    return e.includes(".boss-search-result .search-list") ? true : null;
  };
  b.scanConversations = () => assert.fail("search already located recipient");
  b.until = async () => ({ messages: [] });
  assert.deepEqual(
    await b.openConversation({
      company: "公司",
      recruiter: "HR",
      title: "开发",
    }),
    { messages: [] },
  );
});
