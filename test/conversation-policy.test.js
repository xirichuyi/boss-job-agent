import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationState, RESUME_FILE } from '../src/workflows/conversation-policy.js';
import { VisibleTools } from '../src/visible-tools.js';
const request = { text: '方便发一份简历过来吗？', self: false, system: false };
test('HR request enables only selected resume version', () => {
  assert.equal(RESUME_FILE, 'resume.pdf');
  assert.equal(conversationState({ messages: [request] }).attachment, 'send_requested');
});
test('manual platform attachment receipt prevents sending again', () => {
  const s = conversationState({ messages: [request, { text: '您的附件简历 简历-杨警... 已发送给Boss点击查看附件', system: true, self: false }] });
  assert.equal(s.attachment, 'already_sent'); assert.equal(s.human.length, 1);
});
test('system read notices are not HR dialogue; refusal is respected', () => {
  assert.equal(conversationState({ messages: [{ text: '对方已查看了您的附件简历', system: true }] }).latest, undefined);
  assert.equal(conversationState({ messages: [{ ...request, text: '不用发简历' }] }).attachment, 'none');
});
test('manual text response is included as latest human activity', () => {
  const s = conversationState({ messages: [request, { text: '已经发过了', self: true, system: false }] });
  assert.equal(s.attachment, 'none'); assert.equal(s.latest.self, true);
});
test('resume adapter stops on changed history before clicking anything', async () => {
  const b = new VisibleTools(); b.openConversation = async () => ({ messages: [request] });
  await assert.rejects(b.sendResume({}, RESUME_FILE, { messages: [] }, () => assert.fail('must not persist')), /历史变化/);
});
