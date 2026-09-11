import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { searchCities, searchSlot } from "../src/config/job-filters.ts";
import { hardReject } from "../src/application/job-policy.ts";
import { checkInbox } from "../src/application/inbox.ts";

test("all city-keyword-salary combinations rotate without dropping a city", () => {
  const cities = searchCities(),
    seen = new Set();
  for (let i = 0; i < cities.length * 3 * 3; i++) {
    const s = searchSlot(i, 3);
    seen.add([s.city.name, s.keywordIndex, s.filters.salary].join(":"));
    assert.equal(
      hardReject({
        location: s.city.name,
        title: "开发",
        salary: "11-20K",
        scaleEvidence: "verified",
      }),
      null,
    );
  }
  assert.equal(seen.size, cities.length * 3 * 3);
  assert.ok(
    hardReject({
      location: "北京",
      salary: "11-20K",
      scaleEvidence: "verified",
    }),
  );
});
test("resume receipt does not swallow another question; reply uses refreshed history", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-reply-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(root + "/memory");
  fs.writeFileSync(root + "/candidate-profile.md", "Go项目经验");
  const first = {
    messages: [
      { id: "1", text: "发份简历，做过Go吗", self: false, system: false },
    ],
  };
  const after = {
    messages: [
      ...first.messages,
      { id: "2", text: "您的附件简历已发送给Boss", self: false, system: true },
    ],
  };
  let sentResume = 0,
    sentText = 0;
  const entry = {
    status: "delivered",
    job: { id: "job", company: "公司", recruiter: "HR", salary: "11-20K" },
  };
  const report = {
    intents: [],
    receipts: [],
    result: { messagesSent: 0, attachmentsSent: 0, repliesSent: 0 },
  };
  await checkInbox({
    root,
    ledger: { contacts: [entry] },
    report,
    save() {},
    progress() {},
    assertAuthority() {},
    decide: async (job, history) => {
      assert.equal(history, after);
      return { action: "reply", message: "做过，之前用Go写过门禁网关。" };
    },
    chat: {
      openConversation: async () => (sentResume ? after : first),
      sendResume: async (job, file, history, persist) => {
        persist();
        sentResume++;
        return { text: "receipt" };
      },
      sendText: async (job, msg, history, persist) => {
        assert.equal(history, after);
        persist();
        sentText++;
        return { text: msg };
      },
    },
  });
  assert.equal(sentResume, 1);
  assert.equal(sentText, 1);
  assert.equal(report.result.repliesSent, 1);
});
test("reply and search are registered as independent coordinated lanes", () => {
  const s = fs.readFileSync(
    new URL("../src/application/cycle-runner.ts", import.meta.url),
    "utf8",
  );
  assert.ok(s.includes("await runParallelLanes("));
  assert.match(s, /inbox:\s*lane\(["']inbox["']/);
  assert.match(s, /search:\s*lane\(["']search["']/);
  assert.match(s, /chat:\s*inboxChat/);
});
