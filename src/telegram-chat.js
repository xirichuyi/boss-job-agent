import { AGENT } from './agent-config.js';
import { searchCities } from './job-filters.js';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { atomicJson } from './schedule-state.js';
import { serviceHealth, effectiveStatus } from './service-health.js';
import { readState } from './harness-store.js';
import { callCodex, MODEL, REASONING_EFFORT } from './codex-adapter.js';
import { buildPrompt } from './prompt-builder.js';
import { profileContext } from './model-context.js';
import { cooldown } from './model-budget.js';

export function readJson(file, fallback = null) {
  return readState(file, fallback);
}
export function authorizedMessage(update, chatId, since) {
  const m = update.message;
  return !!(Number.isSafeInteger(update.update_id) && m?.chat?.type === 'private' &&
    m.chat.id === chatId && m.from?.id === chatId && typeof m.text === 'string' &&
    m.date * 1000 >= Date.parse(since));
}
export function snapshot(root) {
  const service = serviceHealth();
  const status = effectiveStatus(readJson(root + '/memory/scheduler-status.json', {}), service);
  const cycle = readJson(root + '/memory/scheduled-cycle.json', {});
  const id = /^[a-f0-9-]{36}$/.test(cycle.id || '') ? cycle.id : null;
  const report = id ? readJson(`${root}/memory/cycles/${id}.json`, {}) : {};
  const contacts = readJson(root + '/memory/outreach-ledger.json', { contacts: [] }).contacts;
  return { capturedAt: new Date().toISOString(), model: MODEL, reasoningEffort: REASONING_EFFORT, status, service,
    inboxDiscovery: readJson(root + '/memory/inbox-discovery.json', null), reconciliation: report.reconciliation,
    cycle: { id: cycle.id, status: cycle.status, at: cycle.at, result: cycle.result, reason: cycle.reason, summary: cycle.summary },
    reviews: (report.jobReviews || []).map(j => ({ company: j.company, title: j.title, rejected: j.rejected, decision: j.decision })),
    contacts: contacts.map(e => ({ company: e.job.company, title: e.job.title, status: e.status, pendingUser: e.pendingUser,
      lastMessage: e.intent?.message, deliveryStage:e.deliveryStage, contactRecovery:e.contactRecovery, platformAttachment: e.platformAttachment, platformCheckedAt: e.platformCheckedAt })),
    alerts: readJson(root + '/memory/alerts.json', []).filter(a => a.status === 'open').slice(-10).map(a => ({ kind: a.kind, reason: a.reason, at: a.lastSeen })) };
}
export function statusText(s) {
  const c = { ...s.cycle, reason: s.cycle.reason || s.cycle.summary?.explanation }, r = c.result;
  return `求职 Agent 状态：${s.status.state || '未知'}\n阶段：${s.status.phase || '—'}\n当前岗位：${s.status.company || '—'} / ${s.status.job || '—'}\n本轮：${c.status || '未知'}${r ? `；已确认新联系 ${r.newContacts} 人，消息 ${r.messagesSent} 条，附件 ${r.attachmentsSent} 份` : '；尚无完成结果'}\n原因：${c.reason || '—'}\n下一次检查/运行：${s.status.nextAt || '执行中或待调度'}\n数据时间（UTC）：${s.capturedAt}\n上限：每天${AGENT.schedule.dailyNewContactLimit}位新HR；${searchCities().map(c=>c.name).join("、")}、${AGENT.search.minimumCompanySize}人以上；不保证凑满。`;
}
export function answerQuestion(root, question, history, runner = spawnSync) {
  const context = snapshot(root);
  const paused = cooldown(root);
  if (paused) return `${MODEL}用量暂受限，下次检查：${paused.until}（UTC）。\n${statusText(context)}`;
  const key = randomUUID(), dir = root + '/memory/telegram-chat-runs';
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const output = `${dir}/${key}.txt`, log = fs.openSync(`${dir}/${key}.jsonl`, 'wx', 0o600);
  const { text: prompt, version } = buildPrompt('telegram', { profile: profileContext(root), snapshot: context, history: history.slice(-6), earlierTurnsOmitted: Math.max(0, history.length - 6), question });
  fs.writeFileSync(output + '.prompt-version.json', JSON.stringify({ kind: 'telegram', version }), { mode: 0o600, flag: 'wx' });
  let run;
  try {
    run = callCodex(['-a', 'never', 'exec', '--ignore-user-config', '--sandbox', 'read-only',
      '-c', 'features.shell_tool=false', '-c', 'features.apps=false', '-c', 'features.browser_use=false',
      '-c', 'features.multi_agent=false', '-c', 'features.computer_use=false', '-c', 'web_search="disabled"',
      '-m', MODEL, '--skip-git-repo-check', '--ephemeral', '--json', '-o', output, '-C', root, '-'],
    { input: prompt, cwd: root, budgetRoot: root, usageLog: `${dir}/${key}.jsonl`, stdio: ['pipe', log, log] }, runner);
  } catch (e) {
    if (e.code === 'MODEL_COOLDOWN') return `${MODEL}用量暂受限，下次检查：${e.until}（UTC）。\n${statusText(context)}`;
    throw e;
  } finally { fs.closeSync(log); }
  if (run.status !== 0 || !fs.existsSync(output)) return '求职 Codex 本次回答失败或超时，投递定时器不受影响。你可以发送 /status 查看实际状态，稍后再提问。';
  const result = fs.readFileSync(output, 'utf8').trim();
  return result ? result.slice(0, 3500) : 'Codex 未返回内容，请稍后重试。';
}

export function ingest(state, updates, chatId) {
  for (const u of updates) {
    if (!Number.isSafeInteger(u.update_id) || u.update_id < (state.offset || 0)) continue;
    if (authorizedMessage(u, chatId, state.startedAt) && !state.queue.some(q => q.id === u.update_id))
      state.queue.push({ id: u.update_id, text: u.message.text.slice(0, 8000), status: 'queued' });
    state.offset = Math.max(state.offset || 0, u.update_id + 1);
  }
  return state;
}
export { atomicJson };
