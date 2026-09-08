import fs from 'node:fs';
const value = JSON.parse(fs.readFileSync(process.env.BOSS_AGENT_CONFIG || new URL('../config/agent.json', import.meta.url), 'utf8'));
const s = value.search, c = value.schedule;
for (const [key, max] of Object.entries({ searchMinutes: 4, replyMinutes: 7, searchBatches: 10, detailReadsPerBatch: 50, inboxContactsPerRun: 100, searchPages: 20, paginationWaitMs: 15000, reconcilePerRun: 20, conversationPages: 50 })) {
  if (!Number.isInteger(value.workflow?.[key]) || value.workflow[key] < 1 || value.workflow[key] > max) throw Error('工作流预算无效：' + key);
}
if (!s || !s.city || !/^\d+$/.test(s.cityCode) || !Number.isInteger(s.minimumCompanySize) || s.minimumCompanySize < 1 || !Array.isArray(s.keywords) || !s.keywords.length || s.keywords.some(x => typeof x !== 'string' || !x.trim()) || !s.directions || typeof s.ignoreEducationAndExperience !== 'boolean') throw Error('搜索配置无效');
if (!Array.isArray(s.nativeScaleCodes) || !s.nativeScaleCodes.length || s.nativeScaleCodes.some(x => !Number.isInteger(x) || x < 301 || x > 306) || new Set(s.nativeScaleCodes).size !== s.nativeScaleCodes.length) throw Error('原生公司规模配置无效');
if (!c || !Number.isInteger(c.intervalMinutes) || c.intervalMinutes < 1 || !Number.isInteger(c.perRun) || c.perRun < 0 || c.perRun > 10 || !Number.isInteger(c.dailyNewContactLimit) || c.dailyNewContactLimit < 1 || c.dailyNewContactLimit > 70) throw Error('调度配置无效（每日安全上限70）');
for (const url of [value.browser?.cdpUrl, value.browser?.publicUrl]) if (!['http:', 'https:'].includes(new URL(url).protocol)) throw Error('浏览器地址无效');
for (const key of ['vncPort', 'webPort']) if (!Number.isInteger(value.browser[key]) || value.browser[key] < 1024 || value.browser[key] > 65535) throw Error('浏览器端口无效');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value.browser.cdpUrl).hostname)) throw Error('CDP只能通过本机或SSH隧道连接，不允许公网调试端口');
if (typeof value.browser.binary !== 'string' || !value.browser.binary.trim() || /[\r\n]/.test(value.browser.binary)) throw Error('浏览器程序配置无效');
if (!value.resumeFile || /[/\\]/.test(value.resumeFile)) throw Error('resumeFile 必须为平台附件文件名');
if (!value.codex?.binary || !Number.isInteger(value.codex.timeoutMs) || value.codex.timeoutMs < 1000 || value.codex.timeoutMs > 120000) throw Error('Codex配置无效');
if (typeof value.codex.binary !== 'string' || /[\r\n]/.test(value.codex.binary)) throw Error('Codex程序路径无效');
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export const AGENT = freeze(value);
