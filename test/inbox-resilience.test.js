import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {checkInbox} from '../src/workflows/inbox.js';
import {businessHealth} from '../src/business-health.js';
function fixture(t){
  const root=fs.mkdtempSync(os.tmpdir()+'/boss-resilience-');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(root+'/memory');fs.writeFileSync(root+'/candidate-profile.md','Go项目经验');
  return {root,ledger:{contacts:['a','b'].map(id=>({status:'delivered',job:{id,company:id,recruiter:'HR',salary:'11-20K'}}))},report:{intents:[],receipts:[],result:{messagesSent:0,repliesSent:0,attachmentsSent:0}},save(){},progress(){},assertAuthority(){},decide:async()=>({action:'reply',message:'我用Go做过网关。'})};
}
const history={messages:[{id:'1',self:false,system:false,text:'介绍一下项目'}]};
test('unknown reply is isolated and next HR continues; next cycle cannot resend unknown',async t=>{
  const c=fixture(t),sends=[];
  c.chat={openConversation:async()=>history,sendText:async(job,msg,h,persist)=>{persist();sends.push(job.id);if(job.id==='a')throw Error('receipt timeout');return{text:msg};}};
  await checkInbox(c);
  assert.deepEqual(sends,['a','b']);assert.equal(c.ledger.contacts[0].status,'outcome_unknown');
  assert.ok(c.ledger.contacts[0].pendingWrite);assert.equal(c.report.result.repliesSent,1);
  assert.equal(c.report.inboxSummary.processingFailed,1);
  c.chat.openConversation=async()=>({messages:[{self:true,text:'已答复'}]});
  await checkInbox(c);assert.deepEqual(sends,['a','b']);
});
test('read failure backs off without starving another contact',async t=>{
  const c=fixture(t),reads=[];
  c.chat={openConversation:async job=>{reads.push(job.id);if(job.id==='a')throw Error('页面内容未就绪');return{messages:[{self:true,text:'已回复'}]};}};
  await checkInbox(c);assert.ok(Date.parse(c.ledger.contacts[0].inboxRetry.nextAt)>Date.now());
  await checkInbox(c);assert.deepEqual(reads,['a','a','b','b']);assert.equal(c.report.inboxSummary.retryDeferred,1);
});
test('authentication still stops all work',async t=>{
  const c=fixture(t);c.chat={openConversation:async()=>{throw Error('需要登录验证');}};
  await assert.rejects(checkInbox(c),/登录验证/);
});
test('pause before write cancels no unknown status and stops work',async t=>{
  const c=fixture(t);c.assertAuthority=()=>{throw Object.assign(Error('任务已暂停或维护'),{code:'TASK_PAUSED'});};
  c.chat={openConversation:async()=>history,sendText:async(j,m,h,persist)=>persist()};
  await assert.rejects(checkInbox(c),/暂停/);assert.equal(c.ledger.contacts[0].status,'delivered');
});
test('business health counts each completed cycle once and never flags zero sends alone',()=>{
  let state={};
  for(let i=0;i<3;i++)state=businessHealth(state,{id:String(i),status:'completed',summary:{inbox:{readFailed:4}}});
  assert.equal(state.state,'degraded');assert.equal(state.failureStreak,3);
  assert.equal(businessHealth(state,{id:'2',status:'completed'}),state);
  state=businessHealth(state,{id:'3',status:'completed',summary:{inbox:{noNewMessage:50}}});
  assert.equal(state.state,'healthy');assert.equal(state.failureStreak,0);
});
