import test from "node:test";
import assert from "node:assert/strict";
import { rejectJobFilters, salaryRangeK } from "../src/config/job-filters.ts";
const config = {
  minimumMonthlySalaryK: 11,
  excludeInternships: true,
  unknownSalaryAction: "skip",
};
test("monthly lower bound is at least 11K, not the upper bound or annualized bonus", () => {
  for (const salary of [
    "11-15K",
    "11K-15K",
    "11K",
    "1.1-1.5万/月",
    "11000-15000元/月",
  ])
    assert.equal(
      rejectJobFilters({ title: "开发工程师", salary }, config),
      null,
      salary,
    );
  for (const salary of [
    "8-15K",
    "10-20K·16薪",
    "200-400元/天",
    "11K/年",
    "面议",
    "15-11K",
    "",
  ])
    assert.ok(
      rejectJobFilters({ title: "开发工程师", salary }, config),
      salary,
    );
  assert.deepEqual(salaryRangeK("11-20K·13薪"), { minimum: 11, maximum: 20 });
});
test("internship jobs are excluded without rejecting ordinary jobs valuing internship experience", () => {
  for (const job of [
    { title: "产品实习生" },
    { title: "Software Engineer Intern" },
    { title: "开发", proof: { description: "岗位性质：实习" } },
  ])
    assert.equal(
      rejectJobFilters({ ...job, salary: "15-20K" }, config),
      "排除实习岗位",
    );
  assert.equal(
    rejectJobFilters(
      {
        title: "产品经理",
        salary: "11-15K",
        requirements: ["应届生"],
        text: "有实习经历优先，正式全职岗位",
      },
      config,
    ),
    null,
  );
});
