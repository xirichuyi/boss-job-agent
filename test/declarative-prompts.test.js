import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../src/prompt-builder.js';
test('contact, batch and replies all request declarative HR messages', () => {
  for (const kind of ['contact', 'contact-batch', 'reply']) {
    const prompt = buildPrompt(kind, {}).text;
    assert.match(prompt, /只用陈述句/);
    assert.match(prompt, /不使用问号|不把疑问句换成句号/);
  }
  assert.match(buildPrompt('contact', {}).text, /不要求HR解释岗位/);
  assert.match(buildPrompt('reply', {}).text, /缺少需要本人确认的信息/);
});
