import { AGENT } from "../config/agent.ts";
import { readState } from "../storage/harness.ts";
import { atomicJson } from "../storage/state.ts";
import { searchSlot } from "../config/job-filters.ts";
export async function searchJobs({ root, report, jobs, progress }) {
  const cursorPath = root + "/memory/search-cursor.json";
  const cursor = readState(cursorPath, { next: 0 });
  const queries = AGENT.search.keywords;
  if (!Number.isInteger(cursor.next) || cursor.next < 0)
    throw new Error("搜索游标无效");
  const slot = searchSlot(cursor.next, queries.length);
  report.query = queries[slot.keywordIndex];
  report.searchCity = slot.city;
  report.queries ||= [];
  report.queries.push(report.query);
  progress("native_keyword_search", { query: report.query });
  report.nativeFilters = slot.filters;
  await jobs.searchKeyword(report.query, report.nativeFilters, slot.city);
  atomicJson(cursorPath, { next: cursor.next + 1 });
  progress("read_native_filtered_jobs");
  let list = await jobs.listJobs();
  report.searchPages ||= [];
  report.searchPages.push({
    query: report.query,
    page: 1,
    visible: list.length,
  });
  report.currentSearchIds = list.map((j) => j.id);
  report.listCount = (report.listCount || 0) + list.length;
  // Rotate the review start across cycles, retaining the same hard requirements.
  const start =
    (Math.floor(cursor.next / queries.length) *
      AGENT.workflow.detailReadsPerBatch) %
    Math.max(1, list.length);
  list = [...list.slice(start), ...list.slice(0, start)];
  return list;
}

export async function nextSearchPage({ report, jobs, progress }, page) {
  progress("load_more_jobs", { page });
  if (!(await jobs.loadMoreJobs())) {
    report.searchStop = "当前翻页未获得新岗位，不代表全站耗尽";
    return [];
  }
  const visible = await jobs.listJobs(),
    seen = new Set(report.currentSearchIds || []);
  const fresh = visible.filter((j) => j.id && !seen.has(j.id));
  report.currentSearchIds = [...new Set([...seen, ...fresh.map((j) => j.id)])];
  report.searchPages.push({
    query: report.query,
    page,
    visible: visible.length,
    newJobs: fresh.length,
    method: jobs.lastPageMethod,
  });
  report.listCount += fresh.length;
  return fresh;
}
