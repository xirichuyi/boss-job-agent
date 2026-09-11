import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkInbox } from "../src/application/inbox.ts";
import { VisibleTools } from "../src/adapters/browser/visible.ts";

test("verified unread contacts are checked first, unknown contacts never sent to", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-discovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(root + "/memory");
  const ledger = {
    contacts: ["a", "b"].map((id) => ({
      status: "delivered",
      job: { id, company: id, recruiter: "HR", salary: "11-15K" },
    })),
  };
  const checked = [];
  const report = { intents: [], receipts: [], result: { messagesSent: 0 } };
  await checkInbox({
    root,
    ledger,
    report,
    progress() {},
    save() {},
    assertAuthority() {},
    decide: () => assert.fail("no unanswered message"),
    chat: {
      scanConversations: async () => ({
        complete: false,
        rows: [
          { label: "b", recruiter: "HR", unread: true },
          { label: "unknown", recruiter: "Other HR", unread: true },
        ],
      }),
      openConversation: async (job) => {
        checked.push(job.id);
        return { messages: [{ self: true, text: "已答复" }] };
      },
      sendText: () => assert.fail("must not send"),
    },
  });
  assert.deepEqual(checked, ["b", "a"]);
  const discovery = JSON.parse(
    fs.readFileSync(root + "/memory/inbox-discovery.json"),
  );
  assert.equal(discovery.unverified.length, 1);
  assert.equal(discovery.reachedRenderedEnd, false);
});
test("hidden known conversation triggers bounded list lookup before opening", async () => {
  const b = new VisibleTools();
  let scanned = 0;
  b.clearSearch = async () => {};
  b.evaluate = async () => null;
  b.searchHistory = async () => ({ empty: true });
  b.scanConversations = async ({ findJob, deadline }) => {
    assert.equal(findJob.id, "job");
    assert.ok(Number.isFinite(deadline));
    scanned++;
    return { found: true };
  };
  b.until = async () => ({ messages: [] });
  await b.openConversation({
    id: "job",
    company: "company",
    recruiter: "HR",
    title: "title",
  });
  assert.equal(scanned, 1);
});
