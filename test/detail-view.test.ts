import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { detailViewExpression } from "../src/adapters/browser/detail-view.ts";
import { summarizeCycle } from "../src/application/summary.ts";

const proof = {
  id: "job",
  title: "Go开发",
  company: "用人企业",
  recruiter: "招聘者",
  identity: "猎头公司 · 顾问",
};
function read(overrides = {}, diagnostic = false) {
  const state = {
    href: "/job_detail/job.html",
    title: "Go开发",
    recruiter: "招聘者",
    identity: "猎头公司 · 顾问",
    ...overrides,
  };
  const boss = {
    querySelector: (s) =>
      s === ".name"
        ? { childNodes: [{ textContent: state.recruiter }] }
        : { textContent: state.identity },
  };
  const detail = {
    innerText: state.title + "\n职位描述",
    querySelector: () => boss,
    querySelectorAll: () => [],
  };
  const document = {
    querySelector: (s) =>
      s === ".job-detail-box" ? detail : { getAttribute: () => state.href },
  };
  return vm.runInNewContext(detailViewExpression(proof, diagnostic), {
    document,
  });
}
test("agency employer differs from recruiter company without invalidating ID-bound detail", () => {
  assert.equal(read().proof.company, "用人企业");
  assert.equal(read().identity, "猎头公司 · 顾问");
  assert.ok(read({ identity: " 猎头公司·顾问 " }));
});
test("wrong job, recruiter, title or recruiter identity remain rejected", () => {
  for (const change of [
    { href: "/job_detail/other.html" },
    { title: "另一岗位" },
    { recruiter: "别人" },
    { identity: "别家公司 · 顾问" },
  ])
    assert.equal(read(change), null);
  assert.equal(read({ identity: "别家公司" }, true).identity, false);
});
test("zero-send summary explicitly reports detail failures", () => {
  const result = summarizeCycle({
    status: "completed",
    result: { messagesSent: 0 },
    jobReviews: [{ rejected: "本轮详情读取失败，未发送：页面内容未就绪" }],
  });
  assert.match(result.explanation, /1次岗位详情读取失败/);
});
