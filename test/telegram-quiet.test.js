import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { flushTelegram } from '../src/telegram.js';

function setup(t, alerts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-quiet-test-'));
  fs.mkdirSync(root + '/memory');
  for (const [name, value] of Object.entries({ 'telegram-secrets': { token: 'TEST' }, 'telegram-config': { chatId: 1 }, alerts }))
    fs.writeFileSync(`${root}/memory/${name}.json`, JSON.stringify(value));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('an alert waiting for retry does not block a later authentication alert',async t=>{
  const root=setup(t,[{id:'wait',kind:'authentication',status:'open',telegram:{retryAt:new Date(Date.now()+60000).toISOString()}},{id:'due',kind:'authentication',status:'open'}]);
  let body;
  await flushTelegram(root,async(_,options)=>{body=JSON.parse(options.body);return{json:async()=>({ok:true,result:{message_id:5}})}});
  assert.match(body.text,/due/);
});
test('ordinary alerts and missing welcome marker send nothing', async t => {
  const root = setup(t, ['hr_pending', 'history_read_failed', 'review', 'outcome_unknown'].map(kind => ({ kind, status: 'open' })));
  const result = await flushTelegram(root, () => assert.fail('unsolicited routine notification'));
  assert.equal(result.sent, 0);
  assert.equal(JSON.parse(fs.readFileSync(root + '/memory/alerts.json')).length, 4);
});
test('authentication alert is retained and sent once', async t => {
  const root = setup(t, [{ id: 'auth1', kind: 'authentication', status: 'open', reason: '需要扫码' }]);
  let sends = 0;
  const fetcher = async (_, options) => {
    sends++;
    assert.match(JSON.parse(options.body).text, /扫码/);
    return { json: async () => ({ ok: true, result: { message_id: 3 } }) };
  };
  assert.equal((await flushTelegram(root, fetcher)).sent, 1);
  assert.equal((await flushTelegram(root, fetcher)).sent, 0);
  assert.equal(sends, 1);
});
test('exhausted contact recovery sends one summary, ordinary retries remain quiet',async t=>{
  const root=setup(t,[{id:'recovery',kind:'contact_recovery_exhausted',status:'open',reason:'恢复已达重试上限'},{id:'pending',kind:'contact_recovery_pending',status:'open'}]);
  let calls=0;const fetcher=async()=>{calls++;return{json:async()=>({ok:true,result:{message_id:9}})}};
  await flushTelegram(root,fetcher);await flushTelegram(root,fetcher);
  assert.equal(calls,1);
});
test('chat loop has no automatic welcome or cycle sender; watchdog never sends Telegram', () => {
  const loop = fs.readFileSync(new URL('../scripts/telegram-chat.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(loop, /await send\(help\)|本轮求职结果|state\.summaries\.push/);
  assert.match(loop, /await send\(item.answer\)/);
  const watchdog = fs.readFileSync(new URL('../scripts/watchdog.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(watchdog, /telegramCall|sendMessage/);
});
