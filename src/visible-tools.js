import { AGENT } from './agent-config.js';
import { BossTools } from './boss-tools.js';
import { parseCompanySize } from './ranker.js';
import { validateOutwardMessage } from './job-policy.js';

export class VisibleTools extends BossTools {
  async observeNativeResponses() {
    if (this.observing) return;
    this.observing = true; this.listProofs = new Map(); this.detailProofs = new Map();
    const pending = new Map();
    this.onEvent = event => {
      if (event.method === 'Network.responseReceived') {
        const path = new URL(event.params.response.url).pathname;
        if (['/wapi/zpgeek/search/joblist.json', '/wapi/zpgeek/job/detail.json'].includes(path)) pending.set(event.params.requestId, path);
      }
      if (event.method === 'Network.loadingFinished' && pending.has(event.params.requestId)) {
        const id = event.params.requestId, path = pending.get(id); pending.delete(id);
        this.call('Network.getResponseBody', { requestId: id }).then(result => {
          const body = JSON.parse(result.base64Encoded ? Buffer.from(result.body, 'base64').toString() : result.body);
          if (body.code !== 0) { this.evidenceError = 'BOSS业务错误 ' + body.code; return; }
          if (path.endsWith('joblist.json')) {
            for (const j of body.zpData?.jobList || []) this.listProofs.set(j.encryptJobId, {
              id: j.encryptJobId, companySize: j.brandScaleName, company: j.brandName,
              location: [j.cityName, j.areaDistrict, j.businessDistrict].filter(Boolean).join('·'), salary: j.salaryDesc,
            });
          } else {
            const d = body.zpData, j = d?.jobInfo;
            if (j?.encryptId) this.detailProofs.set(j.encryptId, {
              id: j.encryptId, title: j.jobName, description: j.postDescription,
              company: d.brandComInfo?.brandName, companySize: d.brandComInfo?.scaleName,
              recruiter: d.bossInfo?.name, identity: `${d.bossInfo?.brandName} · ${d.bossInfo?.title}`,
              location: j.locationName, receivedAt: new Date().toISOString(),
            });
          }
        }).catch(() => { this.evidenceError = '原生响应证据读取失败'; });
      }
    };
    await this.call('Network.enable');
  }
  async connectView(view) {
    const path = view === 'chat' ? '/web/geek/chat' : '/web/geek/jobs';
    const targets = await fetch(AGENT.browser.cdpUrl.replace(/\/$/, '') + '/json/list', { signal: AbortSignal.timeout(5000) }).then(r => r.json());
    let target = targets.find(t => { try { const u = new URL(t.url); return t.type === 'page' && u.origin === 'https://www.zhipin.com' && u.pathname === path; } catch { return false; } });
    if (!target && view === 'chat') {
      await this.connect();
      const created = await this.call('Target.createTarget', { url: 'https://www.zhipin.com' + path });
      this.disconnect();
      await new Promise(r => setTimeout(r, 1500));
      await this.connect(created.targetId);
      return;
    }
    if (!target) throw new Error('请打开BOSS岗位搜索页');
    await this.connect(target.id);
    if (view === 'jobs') await this.observeNativeResponses();
  }
  async evaluate(expression) {
    const r = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '页面执行失败');
    return r.result.value;
  }
  async guard() {
    const state = await this.evaluate(`({origin:location.origin,path:location.pathname,text:document.body?.innerText||''})`);
    if (state.origin !== 'https://www.zhipin.com') throw new Error('页面来源不匹配');
    if (/安全验证|异常访问|访问受限|请先登录|扫码登录|请完成验证|拖动滑块|人机验证/.test(state.text) || /captcha|\/verify|\/login/i.test(state.path)) throw new Error('需要人工登录或验证');
  }
  async until(expression, timeout = 20000) {
    const deadline = Date.now() + timeout;
    do {
      await this.guard();
      const result = await this.evaluate(expression);
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 700));
    } while (Date.now() < deadline);
    throw new Error('页面内容未就绪；未刷新或重复导航');
  }
  async filterCompanies() {
    await this.guard();
    for (const key of [301, 302, 303, 304, 305, 306]) {
      await this.evaluate(`(()=>{
        const c=[...document.querySelectorAll('.condition-filter-select')].find(e=>e.textContent.includes('公司规模'));
        if(!c)throw Error('请打开岗位搜索页');
        const e=c.querySelector('[ka="sel-job-rec-scale-${key}"]');
        if(!e)throw Error('筛选结构变化');
        if(e.classList.contains('active')!==${AGENT.search.nativeScaleCodes.includes(key)})e.click();
        return true;
      })()`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const selected = await this.evaluate(`[...document.querySelectorAll('li[ka^="sel-job-rec-scale-"].active')].map(e=>({key:e.getAttribute('ka'),label:e.textContent.trim()}))`);
    if (selected.length !== AGENT.search.nativeScaleCodes.length || !AGENT.search.nativeScaleCodes.every(k => selected.some(s => s.key.endsWith('-' + k)))) throw new Error('原生公司规模筛选未准确生效');
    return selected;
  }
  async listJobs() {
    await this.selectHangzhou();
    await this.filterCompanies();
    const cards = await this.until(`(()=>{const cards=[...document.querySelectorAll('.job-card-wrap')];return cards.length?cards.map(e=>({
      id:e.querySelector('.job-name')?.getAttribute('href')?.split('/job_detail/')[1]?.split('.html')[0],
      title:e.querySelector('.job-name')?.textContent.trim(),company:e.querySelector('.boss-name')?.textContent.trim(),
      location:e.querySelector('.company-location')?.textContent.trim(),requirements:[...e.querySelectorAll('.tag-list li')].map(t=>t.textContent.trim()),
      salary:e.querySelector('.job-salary')?.textContent.trim()
    })):null})()`);
    for (let n = 0; n < 25 && cards.some(c => !this.listProofs?.has(c.id)); n++) {
      if (this.evidenceError) throw new Error(this.evidenceError);
      await new Promise(r => setTimeout(r, 500));
    }
    if (cards.some(c => !this.listProofs?.has(c.id))) throw new Error('岗位列表响应证据未就绪');
    return cards.map(c => {
      const proof = this.listProofs.get(c.id), size = parseCompanySize(proof.companySize);
      return { ...c, ...proof, scaleEvidence: size && size.minimum >= AGENT.search.minimumCompanySize ? '原生筛选+当前岗位响应规模核对' : '' };
    });
  }
  async searchKeyword(query) {
    if (typeof query !== 'string' || !query.trim() || query.length > 40) throw new Error('搜索词无效');
    await this.guard();
    await this.evaluate(`(()=>{
      const cancel=[...document.querySelectorAll('.cancel-btn')].find(e=>e.textContent.trim()==='留在此页');cancel?.click();
      const e=document.querySelector('input[placeholder="搜索职位、公司"]');
      const button=document.querySelector('a.search-btn');if(!e||!button)throw Error('搜索控件不可用');
      e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(query)});
      e.dispatchEvent(new Event('input',{bubbles:true}));button.click();return true;
    })()`);
    await new Promise(r => setTimeout(r, 1500));
    await this.until(`document.querySelector('.job-card-wrap')?true:null`);
    await this.selectHangzhou();
    return this.filterCompanies();
  }
  async loadMoreJobs() {
    await this.guard();
    const before = await this.evaluate(`document.querySelectorAll('.job-card-wrap').length`);
    await this.evaluate(`(()=>{window.scrollTo(0,document.scrollingElement.scrollHeight);return true})()`);
    for (let attempt = 0; attempt < 16; attempt++) {
      await new Promise(r => setTimeout(r, 500));
      await this.guard();
      if (this.evidenceError) throw Error(this.evidenceError);
      if (await this.evaluate(`document.querySelectorAll('.job-card-wrap').length>${before}`)) return true;
    }
    return false; // No growth is not proof that the platform has no more jobs.
  }
  async selectHangzhou() {
    const current = await this.evaluate(`document.querySelector('.cur-city-label')?.textContent.trim()`);
    if (current === AGENT.search.city) return;
    await this.evaluate(`(()=>{const c=document.querySelector('.city-label');if(!c)throw Error('城市筛选不可用');c.click();return true})()`);
    await this.until(`document.querySelector('.city-select-wrapper .city-list-hot')?true:null`);
    await this.evaluate(`(()=>{const e=[...document.querySelectorAll('.city-select-wrapper .city-list-hot li')].find(e=>e.textContent.trim()===${JSON.stringify(AGENT.search.city)}&&e.getBoundingClientRect().width);if(!e)throw Error('原生目标城市选项不可用');e.click();return true})()`);
    await this.until(`document.querySelector('.cur-city-label')?.textContent.trim()===${JSON.stringify(AGENT.search.city)}?true:null`);
    await new Promise(r => setTimeout(r, 1000));
  }
  async detail(id) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id || '')) throw new Error('岗位ID无效');
    await this.guard();
    const alreadyActive = await this.evaluate(`document.querySelector('.job-card-wrap.active .job-name')?.getAttribute('href')==='/job_detail/${id}.html'`);
    if (alreadyActive && !this.detailProofs?.has(id)) {
      // Establish fresh, ID-bound evidence once; no guessed URL navigation.
      await this.evaluate(`(()=>{const c=[...document.querySelectorAll('.job-card-wrap')].find(e=>!e.classList.contains('active'));if(!c)throw Error('缺少可核对的详情响应');c.querySelector('.job-card-box').click();return true})()`);
      await new Promise(r => setTimeout(r, 800));
    }
    await this.evaluate(`(()=>{
      const c=[...document.querySelectorAll('.job-card-wrap')].find(e=>e.querySelector('.job-name')?.getAttribute('href')==='/job_detail/${id}.html');
      if(!c)throw Error('岗位不在当前列表，禁止猜测详情URL');
      if(!c.classList.contains('active'))c.querySelector('.job-card-box').click();
      return c.querySelector('.job-name').textContent.trim();
    })()`);
    for (let n = 0; n < 35 && !this.detailProofs?.has(id); n++) {
      await this.guard(); if (this.evidenceError) throw new Error(this.evidenceError);
      await new Promise(r => setTimeout(r, 500));
    }
    const proof = this.detailProofs?.get(id);
    if (!proof?.company || !proof.recruiter || !proof.description) throw new Error('岗位详情ID证据未就绪');
    const title = proof.title;
    return this.until(`(()=>{
      const d=document.querySelector('.job-detail-box');
      if(!d||!d.innerText.startsWith(${JSON.stringify(title)})||!d.innerText.includes('职位描述'))return null;
      const active=document.querySelector('.job-card-wrap.active .job-name');
      if(active?.getAttribute('href')!=='/job_detail/${id}.html')return null;
      const boss=d.querySelector('.job-boss-info');if(!boss)return null;
      if(boss.querySelector('.name')?.childNodes[0]?.textContent.trim()!==${JSON.stringify(proof.recruiter)}||!boss.querySelector('.boss-info-attr')?.textContent.includes(${JSON.stringify(proof.company)}))return null;
      return {id:${JSON.stringify(id)},title:${JSON.stringify(title)},text:d.innerText,
        proof:${JSON.stringify(proof)},
        recruiter:boss.querySelector('.name')?.childNodes[0]?.textContent.trim(),
        identity:boss.querySelector('.boss-info-attr')?.textContent.trim(),
        buttons:[...d.querySelectorAll('a,button')].filter(e=>/立即沟通|继续沟通/.test(e.textContent)).map(e=>({text:e.textContent.trim(),class:e.className}))};
    })()`);
  }
  async snapshot() {
    await this.guard();
    return this.evaluate(`({path:location.pathname,text:document.body.innerText.slice(0,18000),
      chat:document.querySelector('.chat-conversation')?.innerText,
      controls:[...document.querySelectorAll('input,textarea,[contenteditable],button')].map(e=>({tag:e.tagName,class:e.className,text:e.innerText,placeholder:e.getAttribute('placeholder')}))})`);
  }
  async searchHistory(company) {
    await this.until(`document.querySelector('.boss-search-input')&&document.querySelector('.friend-content')?true:null`);
    await this.evaluate(`(()=>{const e=document.querySelector('.boss-search-input');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(company)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await new Promise(r => setTimeout(r, 1200));
    return this.until(`(()=>{const e=document.querySelector('.boss-search-result');if(!e||!e.innerText.trim())return null;return {query:${JSON.stringify(company)},text:e.innerText,empty:!!e.querySelector('.no-search-data'),scope:'平台近30天联系人搜索'}})()`);
  }
  async clearSearch() {
    await this.evaluate(`(()=>{document.querySelector('.boss-search-container .close')?.click();return true})()`);
  }
  async openConversation(job) {
    await this.clearSearch();
    const expression = `(()=>{const matches=[...document.querySelectorAll('li[role="listitem"]')].filter(e=>{const n=e.querySelector('.name-box');return n&&n.innerText.includes(${JSON.stringify(job.company)})&&n.querySelector('.name-text')?.textContent.trim()===${JSON.stringify(job.recruiter)}});if(matches.length!==1)return null;return matches[0].innerText})()`;
    await this.until(expression, 25000);
    await this.evaluate(`(()=>{const e=[...document.querySelectorAll('li[role="listitem"]')].find(e=>e.querySelector('.name-box')?.innerText.includes(${JSON.stringify(job.company)})&&e.querySelector('.name-text')?.textContent.trim()===${JSON.stringify(job.recruiter)});e.querySelector('.friend-content').click();return true})()`);
    return this.until(`(()=>{const c=document.querySelector('.chat-conversation');if(!c||!c.innerText.includes(${JSON.stringify(job.company)})||!c.innerText.includes(${JSON.stringify(job.recruiter)})||!c.innerText.includes(${JSON.stringify(job.title)}))return null;return {text:c.innerText,messages:[...c.querySelectorAll('.message-item')].map(e=>({text:e.innerText,self:e.classList.contains('item-myself'),system:e.classList.contains('item-system'),id:e.getAttribute('data-mid')}))}})()`);
  }
  async contactReady(job) {
    await this.guard();
    return this.evaluate(`(()=>{const c=document.querySelector('.job-card-wrap.active'),d=document.querySelector('.job-detail-box');if(c?.querySelector('.job-name')?.getAttribute('href')!=='/job_detail/${job.id}.html'||!d?.innerText.includes(${JSON.stringify(job.identity)}))throw Error('联系前岗位/HR身份变化');const bs=[...d.querySelectorAll('a,button')].filter(e=>e.getBoundingClientRect().width>0&&e.textContent.trim()==='立即沟通');if(bs.length!==1)return false;const b=bs[0];return !b.disabled&&b.getAttribute('aria-disabled')!=='true'&&!b.classList.contains('disabled')&&!b.classList.contains('is-disabled')&&getComputedStyle(b).pointerEvents!=='none'})()`);
  }
  async contactOnce(job) {
    await this.guard();
    return this.evaluate(`(()=>{const c=document.querySelector('.job-card-wrap.active');const d=document.querySelector('.job-detail-box');if(c?.querySelector('.job-name')?.getAttribute('href')!=='/job_detail/${job.id}.html'||!d?.innerText.includes(${JSON.stringify(job.identity)}))throw Error('联系前岗位/HR身份变化');const buttons=[...d.querySelectorAll('a,button')].filter(e=>e.getBoundingClientRect().width>0&&e.textContent.trim()==='立即沟通');if(buttons.length!==1)throw Error('非首次联系或按钮不唯一');const b=buttons[0];if(b.disabled||b.getAttribute('aria-disabled')==='true'||b.classList.contains('disabled')||b.classList.contains('is-disabled')||getComputedStyle(b).pointerEvents==='none')throw Error('沟通按钮不可用，未点击');b.click();return 'clicked_once'})()`);
  }
  async sendText(job, message, before, persistAttempt) {
    validateOutwardMessage(message);
    const snapshot = await this.openConversation(job);
    if (JSON.stringify(snapshot.messages) !== JSON.stringify(before.messages)) throw new Error('聊天历史变化，重新评估后再发');
    if (snapshot.messages.some(m => m.self && m.text.includes(message))) throw new Error('消息已存在，不重发');
    const populated = await this.evaluate(`(()=>{const e=document.querySelector('.chat-conversation .chat-input');if(!e)throw Error('输入框不可用');if(e.innerText.trim()&&e.innerText!==${JSON.stringify(message)})throw Error('输入框已有其他内容');e.focus();return e.innerText===${JSON.stringify(message)}})()`);
    if (!populated) await this.call('Input.insertText', { text: message });
    await this.until(`(()=>{const b=document.querySelector('.chat-conversation .btn-send');return b&&!b.disabled&&!b.classList.contains('disabled')?true:null})()`, 5000);
    await this.guard();
    persistAttempt();
    await this.evaluate(`(()=>{const c=document.querySelector('.chat-conversation');if(!c?.innerText.includes(${JSON.stringify(job.company)})||!c.innerText.includes(${JSON.stringify(job.recruiter)})||!c.innerText.includes(${JSON.stringify(job.title)})||c.querySelector('.chat-input')?.innerText!==${JSON.stringify(message)})throw Error('发送目标或输入变化');const m=[...c.querySelectorAll('.message-item')].map(e=>({text:e.innerText,self:e.classList.contains('item-myself'),system:e.classList.contains('item-system'),id:e.getAttribute('data-mid')}));if(JSON.stringify(m)!==${JSON.stringify(JSON.stringify(before.messages))})throw Error('发送前历史变化');const b=c.querySelector('.btn-send');if(!b||b.classList.contains('disabled'))throw Error('发送按钮不可用');b.click();return true})()`);
    return this.until(`(()=>{const c=document.querySelector('.chat-conversation');if(!c?.innerText.includes(${JSON.stringify(job.company)})||!c.innerText.includes(${JSON.stringify(job.recruiter)}))return null;const m=[...c.querySelectorAll('.message-item.item-myself')].filter(e=>e.innerText.includes(${JSON.stringify(message)}));return m.length===1&&/送达|已读/.test(m[0].innerText)?{text:m[0].innerText,confirmedAt:new Date().toISOString()}:null})()`, 25000);
  }
  async sendResume(job, filename, before, persistAttempt) {
    if (filename !== AGENT.resumeFile) throw Error('附件版本未授权');
    const current = await this.openConversation(job);
    if (JSON.stringify(current.messages) !== JSON.stringify(before.messages)) throw Error('聊天历史变化，重新评估后再发');
    if (current.messages.some(m => m.system && /附件简历[\s\S]*已发送给Boss|对方已查看了您的附件简历/.test(m.text))) throw Error('平台已有附件记录，禁止重复发送');
    const historyExpression = `[...document.querySelectorAll('.chat-conversation .message-item')].map(e=>({text:e.innerText,self:e.classList.contains('item-myself'),system:e.classList.contains('item-system'),id:e.getAttribute('data-mid')}))`;
    try {
      await this.evaluate(`(()=>{if(document.querySelector('.boss-popup__wrapper.choose-resume-dialog'))throw Error('已有简历弹窗，暂停核对');const b=document.querySelector('.chat-conversation [d-c="62009"]');if(!b)throw Error('发简历控件不可用');b.click();return true})()`);
      await this.until(`document.querySelector('.boss-popup__wrapper.choose-resume-dialog .resume-list')?true:null`);
      await this.evaluate(`(()=>{const d=document.querySelector('.boss-popup__wrapper.choose-resume-dialog');const rows=[...d.querySelectorAll('.list-item')].filter(e=>e.querySelector('.resume-name')?.textContent===${JSON.stringify(filename)});if(rows.length!==1)throw Error('指定简历不唯一或不存在');rows[0].click();return true})()`);
      await this.until(`(()=>{const d=document.querySelector('.boss-popup__wrapper.choose-resume-dialog');const b=d?.querySelector('.btn-confirm');return d?.querySelector('.list-item.selected .resume-name')?.textContent===${JSON.stringify(filename)}&&b&&!b.disabled&&!b.classList.contains('disabled')?true:null})()`);
      await this.guard();
      if (JSON.stringify(await this.evaluate(historyExpression)) !== JSON.stringify(before.messages)) throw Error('发送前历史变化');
      persistAttempt();
      await this.evaluate(`(()=>{const c=document.querySelector('.chat-conversation'),d=document.querySelector('.boss-popup__wrapper.choose-resume-dialog');if(!c?.innerText.includes(${JSON.stringify(job.company)})||!c.innerText.includes(${JSON.stringify(job.recruiter)})||!c.innerText.includes(${JSON.stringify(job.title)}))throw Error('发送目标变化');if(JSON.stringify(${historyExpression})!==${JSON.stringify(JSON.stringify(before.messages))})throw Error('发送前历史变化');if(d?.querySelector('.list-item.selected .resume-name')?.textContent!==${JSON.stringify(filename)})throw Error('附件选择变化');const b=d.querySelector('.btn-confirm');if(!b||b.disabled||b.classList.contains('disabled'))throw Error('发送按钮不可用');b.click();return true})()`);
      const ids = before.messages.map(m => m.id);
      return await this.until(`(()=>{const c=document.querySelector('.chat-conversation');if(!c?.innerText.includes(${JSON.stringify(job.company)})||!c.innerText.includes(${JSON.stringify(job.recruiter)}))return null;const r=[...c.querySelectorAll('.message-item.item-system')].find(e=>!${JSON.stringify(ids)}.includes(e.getAttribute('data-mid'))&&(e.innerText.includes('您的附件简历')&&e.innerText.includes('已发送给Boss')));return r?{kind:'attachment',filename:${JSON.stringify(filename)},id:r.getAttribute('data-mid'),text:r.innerText,confirmedAt:new Date().toISOString()}:null})()`,25000);
    } finally {
      await this.evaluate(`(()=>{document.querySelector('.boss-popup__wrapper.choose-resume-dialog .boss-popup__close')?.click();return true})()`).catch(()=>{});
    }
  }
}
