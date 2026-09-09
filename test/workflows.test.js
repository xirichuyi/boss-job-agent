import test from 'node:test';
import assert from 'node:assert/strict';
import { contactJobs } from '../src/workflows/outreach.js';
import { summarizeCycle } from '../src/workflows/summary.js';
function context() {
  return { cycle: { newContactAllocation: 3, at: new Date().toISOString() },
    ledger: { contacts: [] }, report: { jobReviews: [], intents: [], receipts: [], result: { newContacts: 0, messagesSent: 0 } },
    progress() {}, save() {}, assertAuthority() {}, list: [], jobs: { contactReady: async () => true }, chat: {} };
}
test('AI greeting is sent verbatim, without a code-generated prefix or suffix', async () => {
  const c = context();
  const job = { id: 'job', company: 'company', title: 'AI产品', location: '杭州', salary: '11-20K', scaleEvidence: 'native', recruiter: 'HR' };
  const message = '您好，我对这个方向挺感兴趣，之前做过企业知识库项目，方便聊聊吗？';
  c.list = [job];
  c.jobs.detail = async () => ({ text: '职位描述需求梳理HR', buttons: [{ text: '立即沟通' }] });
  c.chat.searchHistory = async () => ({ empty: true });
  c.decide = () => ({ action: 'contact', reason: '内部信息不外发', message });
  c.jobs.contactOnce = async () => {};
  c.jobs.contactReady = async () => true;
  c.chat.openConversation = async () => ({ messages: [{ text: '平台默认招呼 送达', self: true }] });
  c.chat.sendText = async (_, text, history, beforeSend) => {
    assert.equal(text, message); beforeSend(); return { confirmedAt: new Date().toISOString() };
  };
  await contactJobs(c);
  assert.equal(c.ledger.contacts[0].intent.message, message);
  assert.equal(c.ledger.contacts[0].status, 'delivered');
});
test('duplicate company is audited and never reaches browser writes', async () => {
  const c = context(); c.list = [{ id: 'job', company: 'company' }]; c.ledger.contacts = [{ job: c.list[0] }];
  await contactJobs(c); assert.equal(c.report.jobReviews.length, 1); assert.match(c.report.jobReviews[0].rejected, /账本防重/);
});
test('disabled contact is skipped without an unknown intent and later cards continue', async () => {
  const c = context();
  c.list = ['a', 'b'].map(id => ({ id, company: id, title: '全栈开发', location: '杭州', salary: '11-20K', scaleEvidence: 'native', recruiter: 'HR' }));
  c.jobs.detail = async () => ({ text: '职位描述开发HR', buttons: [{ text: '立即沟通' }] });
  c.chat.searchHistory = async () => ({ empty: true });
  c.decide = () => ({ action: 'contact', reason: '匹配', message: '您好，我对这个岗位有兴趣，之前做过相关开发。' });
  const checked = []; c.jobs.contactReady = async job => { checked.push(job.id); return false; };
  c.jobs.contactOnce = () => assert.fail('disabled button must not be clicked');
  await contactJobs(c);
  assert.deepEqual(checked, ['a', 'b']);
  assert.equal(c.report.intents.length, 0);
  assert.equal(c.ledger.contacts.length, 0);
  assert.ok(c.report.jobReviews.every(j => /按钮不可用/.test(j.rejected)));
});
test('model skip does not send; completed task is not reported as successful outreach', async () => {
  const c = context(); const job = { id: 'job', company: 'company', title: 'Go工程师', location: '杭州', salary: '11-20K', scaleEvidence: 'native' };
  c.list = [job]; c.jobs.detail = async () => ({ text: 'JD', buttons: [{ text: '立即沟通' }] });
  c.chat.searchHistory = async () => ({ empty: true }); c.decide = () => ({ action: 'skip', reason: '专业不匹配' });
  await contactJobs(c); c.report.status = 'completed'; const s = summarizeCycle(c.report);
  assert.equal(c.report.intents.length, 0); assert.equal(s.outcome, 'completed_no_send'); assert.equal(s.reasons['模型判断不匹配'], 1);
});
test('detail timeout skips one card; authentication stops the workflow', async () => {
  const c = context(); c.list = [{ id: 'job', location: '杭州', salary: '11-20K', scaleEvidence: 'native' }];
  c.jobs.detail = async () => { throw Error('页面内容未就绪'); }; await contactJobs(c);
  assert.equal(c.report.jobReviews.length, 1); assert.equal(c.report.intents.length, 0);
  c.jobs.detail = async () => { throw Error('需要人工登录或验证'); };
  await assert.rejects(contactJobs(c), /验证/);
});
test('production batch path generates once and sends separately after fresh history checks', async () => {
  const c = context(); c.list = ['a', 'b'].map(id => ({ id, company: id, title: 'AI产品', location: '杭州', salary: '11-20K', scaleEvidence: 'native', recruiter: 'HR' }));
  c.jobs.detail = async () => ({ text: '职位描述产品HR', buttons: [{ text: '立即沟通' }] });
  const reads = [], sends = []; let calls = 0;
  c.chat.searchHistory = async company => { reads.push(company); return { empty: true }; };
  c.decide = () => assert.fail('must use batch');
  c.decide.batch = items => { calls++; assert.deepEqual(items.map(x => x.job.id), ['a', 'b']); return items.map(({ job }) => ({ action: 'contact', reason: '匹配', message: '我对' + job.id + '有兴趣，之前做过相关项目，方便聊聊吗？' })); };
  c.jobs.contactOnce = async () => {};
  c.chat.openConversation = async () => ({ messages: [{ text: '默认招呼 送达', self: true }] });
  c.chat.sendText = async (job, text, history, persist) => { persist(); sends.push([job.id, text]); return { text: '送达' }; };
  await contactJobs(c);
  assert.equal(calls, 1); assert.deepEqual(reads, ['a', 'b', 'a', 'b']);
  assert.deepEqual(sends.map(x => x[0]), ['a', 'b']); assert.equal(c.report.result.newContacts, 2);
});
