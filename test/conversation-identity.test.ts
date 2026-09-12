import test from "node:test";
import assert from "node:assert/strict";
import { conversationCompany } from "../src/domain/conversation-identity.ts";
import { VisibleTools } from "../src/adapters/browser/visible.ts";
import vm from "node:vm";
import { conversationIdentityExpression } from "../src/adapters/browser/conversation-view.ts";

const job = {
  id: "job",
  company: "用人企业",
  title: "产品经理",
  recruiter: "HR",
  proof: { id: "job", recruiter: "HR", identity: "猎头公司 · 顾问" },
};
test("native contact and loaded job IDs bind agency chats without company in header", () => {
  const selected = {
    encryptJobId: "job",
    encryptBossId: "boss",
    name: "HR",
    brandName: "猎头公司",
  };
  const loaded = {
    ...selected,
    jobName: "产品经理（代招职位）",
    brandName: "用人企业",
  };
  const chat = {
    __vue__: { selectedFriend$: selected },
    querySelector: (s) =>
      s === ".top-info-content"
        ? { __vue__: { conversation$: loaded } }
        : {
            textContent: s.includes("name-text")
              ? "HR"
              : "产品经理（代招职位）",
          },
  };
  const verify = () =>
    vm.runInNewContext(conversationIdentityExpression(job), {
      document: { querySelector: () => chat },
    });
  assert.equal(verify(), true);
  for (const [target, key, value] of [
    [selected, "encryptJobId", "other"],
    [loaded, "encryptJobId", "other"],
    [loaded, "encryptBossId", "other"],
    [selected, "brandName", "同名但不同公司"],
    [loaded, "name", "另一个HR"],
    [loaded, "jobName", "其他岗位"],
  ]) {
    const old = target[key];
    target[key] = value;
    assert.equal(verify(), false, key);
    target[key] = old;
  }
  delete chat.__vue__.selectedFriend$;
  assert.equal(verify(), false, "missing platform evidence fails closed");
});
test("agency chat identity uses ID-bound evidence without changing employer", () => {
  assert.equal(conversationCompany(job), "猎头公司");
  assert.equal(job.company, "用人企业");
  assert.equal(
    conversationCompany({
      ...job,
      proof: { ...job.proof, recruiterCompany: "招聘公司" },
    }),
    "招聘公司",
  );
  assert.equal(conversationCompany({ ...job, proof: undefined }), "用人企业");
  assert.throws(() => conversationCompany({ ...job, id: "other" }), /不一致/);
  assert.throws(
    () => conversationCompany({ ...job, recruiter: "别人" }),
    /不一致/,
  );
});
test("conversation lookup searches agency but still verifies original job title and recruiter", async () => {
  const browser = new VisibleTools();
  browser.clearSearch = async () => {};
  const expressions = [];
  browser.evaluate = async (expression) => {
    expressions.push(expression);
    return expression.includes("rows[0].click()") ? true : null;
  };
  browser.searchHistory = async (company) => {
    assert.equal(company, "猎头公司");
    return { empty: false };
  };
  browser.until = async (expression) => {
    assert.ok(expression.includes("猎头公司"));
    assert.ok(expression.includes("产品经理"));
    assert.ok(expression.includes("HR"));
    return { messages: [] };
  };
  await browser.openConversation(job);
  assert.equal(job.company, "用人企业");
  assert.ok(expressions.some((e) => e.includes("rows.length!==1")));
});

test("ignored conversation click retries one native search, never a send", async () => {
  const b = new VisibleTools();
  b.clearSearch = async () => {};
  b.evaluate = async () => true;
  let searches = 0,
    views = 0;
  b.searchHistory = async () => {
    searches++;
    return { empty: false };
  };
  b.until = async (expression) => {
    if (!expression.includes("messages:")) return true;
    views++;
    throw Error("页面内容未就绪；未刷新或重复导航");
  };
  await assert.rejects(b.openConversation(job), /CONTACT_VIEW_MISMATCH/);
  assert.equal(searches, 1);
  assert.equal(views, 2);
});
