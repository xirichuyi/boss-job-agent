import test from "node:test";
import assert from "node:assert/strict";
import { hardReject, validateDecision } from "../src/domain/policy.ts";
const base = {
  location: "杭州",
  salary: "11-20K",
  scaleEvidence: "500+",
  title: "AI工程师",
  requirements: ["本科", "在校/应届"],
};
test("education, experience and graduation do not reject; internships are excluded", () => {
  assert.equal(hardReject({ ...base, text: "毕业时间：2027年" }), null);
  assert.equal(hardReject({ ...base, text: "2027届本科在读" }), null);
  assert.equal(
    hardReject({
      ...base,
      title: "产品实习生",
      requirements: ["博士", "10年以上", "5天/周"],
    }),
    "排除实习岗位",
  );
  assert.equal(hardReject({ ...base, text: "2026届毕业生" }), null);
});
test("Hangzhou and verified company scale remain required", () => {
  assert.ok(hardReject({ ...base, location: "上海" }));
  assert.ok(hardReject({ ...base, scaleEvidence: null }));
});
test("no upper company-size cap", () => {
  assert.equal(hardReject({ ...base, scaleEvidence: "10000人以上" }), null);
});
test("honest non-CS background is not mistaken for a false CS claim", () => {
  assert.equal(
    validateDecision({
      action: "contact",
      reason: "match",
      message:
        "您好，我是张三，2026届工业设计本科（非计算机专业），有Go后端与AI应用项目实践。",
    }).action,
    "contact",
  );
});
