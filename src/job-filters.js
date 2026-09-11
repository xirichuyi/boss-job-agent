import fs from 'node:fs';
import { configFile } from './config-files.js';

export function loadJobFilters() {
  const c = JSON.parse(fs.readFileSync(configFile('job-filters'), 'utf8'));
  if (!Number.isFinite(c.minimumMonthlySalaryK) || c.minimumMonthlySalaryK < 0 || typeof c.excludeInternships !== 'boolean' || c.unknownSalaryAction !== 'skip') throw Error('岗位薪资/实习配置无效');
  if (!Number.isInteger(c.conversationPages) || c.conversationPages<1 || c.conversationPages>100 || !Number.isInteger(c.conversationLookupMs) || c.conversationLookupMs<1000 || c.conversationLookupMs>60000) throw Error('会话查找配置无效');
  return c;
}
export function searchCities() {
  const cities = loadJobFilters().cities;
  if (!Array.isArray(cities) || !cities.length || cities.some(c => typeof c.name !== 'string' || !c.name.trim() || !/^\d{9}$/.test(c.code))) throw Error('城市配置无效');
  return cities;
}
export function searchSlot(index, keywordCount) {
  const cities = searchCities();
  const city = cities[index % cities.length];
  const slot = Math.floor(index / cities.length);
  return { city, keywordIndex: slot % keywordCount, filters: nativeFiltersForSearch(slot, keywordCount) };
}
export function nativeFiltersForSearch(index, keywordCount, c = loadJobFilters()) {
  if (!Array.isArray(c.nativeSalaryCodes) || !c.nativeSalaryCodes.length || !c.nativeSalaryCodes.every(k => [402,403,404,405,406,407].includes(k)) || ![0,1901,1903].includes(c.nativeJobType)) throw Error('原生搜索筛选配置无效');
  return { salary: String(c.nativeSalaryCodes[Math.floor(index / keywordCount) % c.nativeSalaryCodes.length]), jobType: c.nativeJobType ? String(c.nativeJobType) : '', experience: '', degree: '' };
}
export function searchRequestFilters(request) {
  const u = new URL(request.url);
  let body;
  try { body = JSON.parse(request.postData || '{}'); } catch { body = Object.fromEntries(new URLSearchParams(request.postData)); }
  return Object.fromEntries(['city','query','salary','scale','jobType','experience','degree'].map(k => [k, String(body[k] ?? u.searchParams.get(k) ?? '')]));
}
export function salaryRangeK(value) {
  const text = String(value || '').replace(/\s/g, '').replace(/[·•]\d+薪$/, '');
  if (/日|天|时|周|年|面议/.test(text)) return null;
  const m = text.match(/^(\d+(?:\.\d+)?)(?:[kK])?[-–—~至](\d+(?:\.\d+)?)([kK]|万|元)(?:\/月)?$/)
    || text.match(/^(\d+(?:\.\d+)?)([kK]|万|元)(?:\/月)?$/);
  if (!m) return null;
  const min=Number(m[1]), max=m.length===4?Number(m[2]):min, unit=m.length===4?m[3]:m[2];
  if (min<=0 || max<min) return null;
  const factor=unit==='万'?10:unit==='元'?0.001:1;
  return {minimum:min*factor, maximum:max*factor};
}
export function rejectJobFilters(job, config = loadJobFilters()) {
  // Use position fields, never the candidate's own internship experience.
  const fields=[job.title, ...(job.requirements || []), job.employmentType, job.jobType].filter(v=>typeof v==='string').join(' ');
  const description=job.proof?.description || job.text || '';
  if (config.excludeInternships && (/实习|intern(?:ship)?\b/i.test(fields) || /(?:岗位性质|职位性质|工作性质|招聘类型)\s*[：:]?\s*实习|招聘实习生|每周(?:到岗|出勤)\s*[一二三四五六七1-7]+\s*天|实习(?:期|时长|时间|至少)\s*[：:]?\s*\d+/.test(description))) return '排除实习岗位';
  const salary = salaryRangeK(job.proof?.salary || job.salary);
  if (!salary) return '薪资未知或不是明确月薪，跳过';
  return salary.minimum < config.minimumMonthlySalaryK ? `月薪下限低于${config.minimumMonthlySalaryK}K，跳过` : null;
}
