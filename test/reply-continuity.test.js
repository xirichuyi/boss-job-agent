import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {checkInbox} from '../src/workflows/inbox.js';
import {readHistory} from '../src/workflows/history-read.js';
import {conversationState} from '../src/workflows/conversation-policy.js';
test('HR follow-up does not erase resume request; later refusal and manual reply are respected',()=>{
  const request={text:'发份简历',self:false,system:false};
  const follow={text:'做过Go吗',self:false,system:false};
  assert.equal(conversationState({messages:[request,follow]}).attachment,'send_requested');
  assert.equal(conversationState({messages:[request,{...follow,text:'不用发了'}]}).attachment,'none');
  assert.equal(conversationState({messages:[request,{text:'我稍后处理',self:true},follow]}).attachment,'none');
});
test('temporary read gets one retry, while identity or authentication error is not bypassed',async()=>{
  let count=0;
  const chat={openConversation:async()=>{if(++count===1)throw Error('页面内容未就绪');return{messages:[]};}};
  assert.deepEqual(await readHistory(chat,{}),{messages:[]});assert.equal(count,2);
  count=0;chat.openConversation=async()=>{count++;throw Error('需要登录验证');};
  await assert.rejects(readHistory(chat,{}),/登录验证/);assert.equal(count,1);
  count=0;chat.openConversation=async()=>{count++;throw Error('页面内容未就绪');};
  await assert.rejects(readHistory(chat,{}, {deadline:Date.now()+1000}));assert.equal(count,1);
});
test('generated reply survives deadline, is reused after fresh history and removed after receipt',async t=>{
  const root=fs.mkdtempSync(os.tmpdir()+'/boss-reply-continuity-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(root+'/memory');fs.writeFileSync(root+'/candidate-profile.md','Go经验');
  const entry={status:'delivered',job:{id:'j',company:'公司',recruiter:'HR',salary:'11-20K'}};
  let calls=0,sends=0;
  const context={root,ledger:{contacts:[entry]},report:{intents:[],receipts:[],result:{messagesSent:0,repliesSent:0}},save(){},progress(){},assertAuthority(){},
    decide:async()=>{calls++;await new Promise(r=>setTimeout(r,150));return{action:'reply',message:'我做过Go网关。'};},
    chat:{openConversation:async()=>({messages:[{id:'m1',self:false,text:'做过Go吗'}]}),sendText:async(j,m,h,persist)=>{persist();sends++;return{text:m};}}};
  await checkInbox({...context,deadline:Date.now()+100});
  assert.equal(sends,0);assert.ok(entry.replyDraft);assert.equal(calls,1);
  await checkInbox(context);assert.equal(sends,1);assert.equal(calls,1);assert.equal(entry.replyDraft,undefined);
});
test('changed platform history invalidates a stored draft before generation',async t=>{
  const root=fs.mkdtempSync(os.tmpdir()+'/boss-stale-draft-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(root+'/memory');fs.writeFileSync(root+'/candidate-profile.md','Go经验');
  const entry={status:'delivered',job:{id:'j',company:'公司',salary:'11-20K'},replyDraft:{historyHash:'old',decision:{action:'reply',message:'旧文案'}}};
  let generated=false;
  await checkInbox({root,ledger:{contacts:[entry]},report:{intents:[],receipts:[],result:{}},save(){},progress(){},assertAuthority(){},
    decide:async()=>{generated=true;return{action:'skip',reason:'对方已拒绝'};},chat:{openConversation:async()=>({messages:[{id:'new',self:false,text:'不合适'}]}),sendText:()=>assert.fail('stale draft')}});
  assert.equal(generated,true);assert.equal(entry.replyDraft,undefined);
});
