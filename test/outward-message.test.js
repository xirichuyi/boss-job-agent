import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOutwardMessage, validateDecision } from '../src/job-policy.js';
test('omitted subject and short greetings pass unchanged', () => {
  for (const message of ['之前做过企业知识库和 Agent，参与需求梳理，想了解下岗位。', '想聊聊这个岗位。']) {
    assert.equal(validateDecision({ action: 'contact', reason: '相关', message }).message, message);
  }
});
test('wording is no longer screened by keyword or length rules', () => {
  // Deliberately poor copy: quality belongs to generation, not regex.
  for (const message of ['候选人可被考虑，具备相关能力。', '**项目经历**', '我是计算机专业毕业生。', '长'.repeat(501)]) {
    assert.equal(validateOutwardMessage(message), message);
  }
});
test('transport structure rejects empty messages and invalid actions', () => {
  for (const message of ['', '  ', null]) assert.throws(() => validateOutwardMessage(message));
  assert.throws(() => validateDecision({ action: 'unknown', reason: '', message: '你好' }));
  assert.throws(() => validateDecision({ action: 'skip', reason: '', message: '你好' }));
});
