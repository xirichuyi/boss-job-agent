import test from "node:test";
import assert from "node:assert/strict";
import { contactJobs } from "../src/application/outreach.ts";
import { summarizeCycle } from "../src/application/summary.ts";
import { businessHealth } from "../src/runtime/business-health.ts";

function fixture() {
  const sent = [],
    batches = [];
  const c = {
    cycle: {
      id: "test",
      at: new Date().toISOString(),
      newContactAllocation: 3,
    },
    list: ["a", "b", "c"].map((id) => ({
      id,
      company: id,
      title: "开发",
      location: "杭州",
      salary: "11-20K",
      scaleEvidence: "native",
      recruiter: "HR",
    })),
    ledger: { contacts: [] },
    report: {
      jobReviews: [],
      intents: [],
      receipts: [],
      result: { newContacts: 0, messagesSent: 0 },
    },
    progress() {},
    save() {},
    assertAuthority() {},
    jobs: {
      detail: async () => ({
        text: "职位描述开发HR",
        buttons: [{ text: "立即沟通" }],
      }),
      contactReady: async () => true,
      contactOnce: async () => {},
    },
    chat: {
      searchHistory: async () => ({ empty: true }),
      openConversation: async () => ({
        messages: [{ self: true, text: "默认招呼 送达" }],
      }),
      sendText: async (job, text, history, persist) => {
        persist();
        sent.push(job.id);
        return { text: "送达" };
      },
    },
    decide: Object.assign(() => assert.fail("batch expected"), {
      batch: async (items) => {
        batches.push(items.map((i) => i.job.id));
        return items.map(() => ({
          action: "contact",
          reason: "匹配",
          message: "我做过相关开发。",
        }));
      },
    }),
  };
  return { c, sent, batches };
}
test("third company history timeout preserves and sends first two verified candidates", async () => {
  const { c, sent, batches } = fixture();
  c.chat.searchHistory = async (company) => {
    if (company === "c") throw Error("页面内容未就绪");
    return { empty: true };
  };
  await contactJobs(c);
  assert.deepEqual(batches, [["a", "b"]]);
  assert.deepEqual(sent, ["a", "b"]);
  assert.equal(c.report.preflightFailures[0].stage, "company_history");
  assert.equal(
    c.ledger.contacts.some((e) => e.job.id === "c"),
    false,
  );
});
test("authentication, pause and storage errors cannot flush pending candidates", async () => {
  for (const error of [
    Error("需要人工登录或验证"),
    Object.assign(Error("暂停"), { code: "TASK_PAUSED" }),
    Object.assign(Error("disk failed"), { code: "EIO" }),
  ]) {
    const { c, sent, batches } = fixture();
    c.chat.searchHistory = async (company) => {
      if (company === "c") throw error;
      return { empty: true };
    };
    await assert.rejects(contactJobs(c), (e) => e === error);
    assert.deepEqual(sent, []);
    assert.deepEqual(batches, []);
  }
});
test("pre-send JD timeout skips only that candidate", async () => {
  const { c, sent } = fixture();
  let reads = 0;
  c.jobs.detail = async (id) => {
    if (id === "a" && ++reads > 1) throw Error("页面内容未就绪");
    return { text: "职位描述开发HR", buttons: [{ text: "立即沟通" }] };
  };
  await contactJobs(c);
  assert.deepEqual(sent, ["b", "c"]);
  assert.equal(c.report.preflightFailures[0].stage, "refresh_jd");
});
test("search warnings remain visible even when an inbox reply was sent", () => {
  const summary = summarizeCycle({
    status: "completed",
    result: { messagesSent: 1 },
    searchWarning: "timeout",
  });
  assert.match(summary.explanation, /搜索异常/);
  assert.ok(
    businessHealth(
      {},
      { id: "test", status: "completed", summary },
    ).reasons.includes("搜索分支异常"),
  );
});
