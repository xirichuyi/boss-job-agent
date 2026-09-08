import { AGENT } from '../agent-config.js';
import { readState } from '../harness-store.js';
import { atomicJson } from '../schedule-state.js';
export async function searchJobs({root, report, jobs, progress}) {
  const cursorPath = root + '/memory/search-cursor.json';
  const cursor = readState(cursorPath, { next: 0 });
  const queries = AGENT.search.keywords;
  if (!Number.isInteger(cursor.next) || cursor.next < 0) throw new Error('搜索游标无效');
  report.query = queries[cursor.next % queries.length];
  report.queries ||= [];
  report.queries.push(report.query);
  progress('native_keyword_search', { query: report.query });
  await jobs.searchKeyword(report.query);
  atomicJson(cursorPath, { next: cursor.next + 1 });
  progress('read_native_filtered_jobs');
  let list = await jobs.listJobs();
  report.searchPages = [{ visible: list.length }];
  for (let page = 0; page < 2; page++) {
    progress('load_more_jobs', { page: page + 2 });
    if (!await jobs.loadMoreJobs()) { report.searchStop = '滚动后没有新增，未认定全站岗位耗尽'; break; }
    list = await jobs.listJobs();
    report.searchPages.push({ visible: list.length });
  }
  report.listCount = (report.listCount || 0) + list.length;
  // Rotate the review start across cycles, retaining the same hard requirements.
  const start = (Math.floor(cursor.next / queries.length) * 6) % Math.max(1, list.length);
  list = [...list.slice(start), ...list.slice(0, start)];
  return list;
}
