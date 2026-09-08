import test from "node:test";
import assert from "node:assert/strict";
import { parseCompanySize, parseMonthlySalaryK, ruleEvaluate } from "../src/ranker.js";

const config = {
  criteria: {
    targetTitles: ["Go开发"], requiredKeywords: ["微服务"], excludeKeywords: ["外包"], cities: ["上海"], minimumMonthlySalaryK: 20, minimumCompanySize: 500,
  },
};

test("parses common BOSS salary format", () => {
  assert.deepEqual(parseMonthlySalaryK("20-35K·14薪"), { minimum: 20, maximum: 35 });
});

test("parses common BOSS company sizes", () => {
  assert.deepEqual(parseCompanySize("500-999人"), { minimum: 500, maximum: 999 });
  assert.deepEqual(parseCompanySize("10000人以上"), { minimum: 10000, maximum: Infinity });
});

test("rejects excluded keywords", () => {
  const result = ruleEvaluate({ title: "Go开发", summary: "外包驻场" }, config);
  assert.equal(result.eligible, false);
});

test("scores a matching job", () => {
  const result = ruleEvaluate({ title: "高级Go开发", summary: "微服务", location: "上海", salary: "25-40K", companySize: "500-999人" }, config);
  assert.equal(result.score, 100);
});

test("hard rejects a company below the requested size", () => {
  const result = ruleEvaluate({ title: "高级Go开发", summary: "微服务", location: "上海", salary: "25-40K", companySize: "100-499人" }, config);
  assert.equal(result.eligible, false);
  assert.match(result.risks[0], /企业规模不足/);
});

test("hard rejects a different city", () => {
  const result = ruleEvaluate({ title: "高级Go开发", summary: "微服务", location: "杭州", salary: "25-40K", companySize: "1000-9999人" }, config);
  assert.equal(result.eligible, false);
  assert.match(result.risks[0], /城市不匹配/);
});
