import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  nativeFiltersForSearch,
  searchRequestFilters,
} from "../src/config/job-filters.ts";
import { VisibleTools } from "../src/adapters/browser/visible.ts";

test("native salary rotation covers every keyword and all configured bands", () => {
  const c = { nativeSalaryCodes: [405, 406, 407], nativeJobType: 1901 };
  for (let i = 0; i < 24; i++) {
    const f = nativeFiltersForSearch(i, 8, c);
    assert.equal(f.salary, String(c.nativeSalaryCodes[Math.floor(i / 8)]));
    assert.equal(f.jobType, "1901");
    assert.equal(f.degree, "");
    assert.equal(f.experience, "");
  }
  assert.equal(nativeFiltersForSearch(24, 8, c).salary, "405");
  assert.throws(() =>
    nativeFiltersForSearch(0, 8, { ...c, nativeSalaryCodes: [] }),
  );
});
test("request evidence extracts native POST filters without credentials", () => {
  const r = searchRequestFilters({
    url: "https://www.zhipin.com/wapi/zpgeek/search/joblist.json",
    postData: "salary=405&jobType=1901&scale=304%2C305%2C306&token=private",
  });
  assert.equal(r.salary, "405");
  assert.equal(r.scale, "304,305,306");
  assert.equal(r.jobType, "1901");
  assert.equal(r.token, undefined);
});
test("native controls use exp DOM key and API experience field", async () => {
  const b = new VisibleTools(),
    expressions = [];
  b.evaluate = async (e) => {
    expressions.push(e);
    new Function("return " + e);
    return true;
  };
  b.until = async (e) => {
    expressions.push(e);
    new Function("return " + e);
    return true;
  };
  await b.applyNativeFilters(nativeFiltersForSearch(0, 1));
  assert.ok(expressions.some((e) => e.includes("sel-job-rec-exp-0")));
  assert.ok(expressions.some((e) => e.includes("sel-job-rec-jobType-1901")));
  assert.ok(expressions.some((e) => e.includes("sel-job-rec-salary-405")));
});
test("active search workflow passes configured filters before reading jobs", () => {
  const s = fs.readFileSync(
    new URL("../src/application/search.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    s.includes(
      "jobs.searchKeyword(report.query, report.nativeFilters, slot.city)",
    ),
  );
  assert.ok(s.indexOf("searchSlot(cursor.next") < s.indexOf("jobs.listJobs()"));
});
