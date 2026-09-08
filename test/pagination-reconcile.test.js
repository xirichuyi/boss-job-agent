import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { hasNewIds, advanceJobsExpression } from '../src/ui-pagination.js';
import { observedReceipt, reconcileUnknown } from '../src/workflows/reconcile.js';
import { nextSearchPage } from '../src/workflows/search.js';

test('virtualized lists advance even when card count stays unchanged', () => {
  assert.equal(hasNewIds(['a','b'], ['c','d']), true);
  assert.equal(hasNewIds(['a','b'], ['b','a']), false);
});
test('pagination scrolls inner container rather than the outer window', () => {
  const container = { scrollTop:0, scrollHeight:1000, clientHeight:100, parentElement:null };
  const document = { querySelector:()=>({parentElement:container}) };
  assert.equal(vm.runInNewContext(advanceJobsExpression, {document,getComputedStyle:()=>({overflowY:'auto'})}), 'container_scroll');
  assert.equal(container.scrollTop, 1000);
});
test('pagination uses a unique enabled native next-page control', () => {
  let clicks=0;
  const button={getBoundingClientRect:()=>({width:30}),textContent:'下一页',disabled:false,getAttribute:()=>null,className:'',click:()=>clicks++};
  const document={querySelector:()=>({parentElement:null}),querySelectorAll:()=>[button]};
  assert.equal(vm.runInNewContext(advanceJobsExpression,{document}), 'next_page');
  assert.equal(clicks,1);
  button.disabled=true; assert.equal(vm.runInNewContext(advanceJobsExpression,{document}), 'no_control');
});
test('next page processes only fresh IDs currently rendered', async () => {
  const report={currentSearchIds:['a'],searchPages:[],listCount:1,query:'Go'};
  const list=await nextSearchPage({report,progress(){},jobs:{loadMoreJobs:async()=>true,listJobs:async()=>[{id:'a'},{id:'b'}]}},2);
  assert.deepEqual(list,[{id:'b'}]); assert.equal(report.listCount,2);
});
test('read-only reconciliation requires a fresh unique exact delivered message', () => {
  const pending={kind:'text',message:'你好，想了解岗位。',beforeIds:['old']};
  const m={id:'new',self:true,system:false,text:'04:34\n送达\n\n你好，想了解岗位。'};
  assert.equal(observedReceipt(pending,{messages:[m]}).id,'new');
  for(const messages of [[{...m,id:'old'}],[m,{...m,id:'other'}],[{...m,text:'你好，想了解岗位。'}],[{...m,text:m.text+'其他文字'}]]) assert.equal(observedReceipt(pending,{messages}),null);
  assert.equal(observedReceipt({...pending,beforeIds:[null]},{messages:[m]}),null);
});
test('reconciliation never resends or increases agent totals', async () => {
  const entry={job:{id:'a'},status:'quarantined',pendingWrite:{kind:'text',message:'你好',beforeIds:['old']}};
  const report={result:{messagesSent:0,newContacts:0}};
  await reconcileUnknown({ledger:{contacts:[entry]},report,save(){},chat:{openConversation:async()=>({messages:[{id:'new',self:true,text:'送达\n你好'}]}),sendText:()=>assert.fail('must never write')}});
  assert.equal(entry.status,'delivered'); assert.equal(report.result.messagesSent,0);
  assert.equal(report.reconciliation.restored,1);
});
test('old unknown attempts without baseline remain isolated', async () => {
  const entry={job:{id:'a'},status:'quarantined'};
  await reconcileUnknown({ledger:{contacts:[entry]},report:{},save(){},chat:{openConversation:()=>assert.fail('no evidence baseline')}});
  assert.equal(entry.status,'quarantined');
});
