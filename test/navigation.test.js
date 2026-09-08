import test from 'node:test';
import assert from 'node:assert/strict';
import { BossTools } from '../src/boss-tools.js';
test('navigation timeout checks actual loaded page without a second navigation', async () => {
  const b = new BossTools(); let navigations = 0;
  b.call = async method => {
    if (method === 'Page.navigate') { navigations++; throw new Error('Page.navigate 超时'); }
    return { result: { value: { url: 'https://www.zhipin.com/job_detail/example.html', hasBody: true, ready: 'complete' } } };
  };
  assert.equal((await b.navigate('https://www.zhipin.com/job_detail/example.html')).recoveredFromTimeout, true);
  assert.equal(navigations, 1);
});
test('verification redirect stops instead of reporting success', async () => {
  const b = new BossTools();
  b.call = async method => method === 'Page.navigate' ? {} : { result: { value: { url: 'https://www.zhipin.com/web/passport/verify', hasBody: true, ready: 'complete' } } };
  await assert.rejects(b.navigate('https://www.zhipin.com/job_detail/example.html'), /验证/);
});
