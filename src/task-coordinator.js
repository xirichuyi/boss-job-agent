import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import { configFile } from './config-files.js';

export function executionConfig() {
  const config=JSON.parse(fs.readFileSync(configFile('execution'),'utf8'));
  if(typeof config.parallelWorkflows!=='boolean')throw Error('并行调度配置无效');
  const r=config.contactRecovery;
  if(!r || !['perRun','minutes','maxAttempts','retryMinutes'].every(k=>Number.isInteger(r[k])&&r[k]>0) || r.minutes>3 || r.perRun>10 || r.maxAttempts>10)throw Error('联系人恢复配置无效');
  config.inboxRetry={baseMinutes:30,maxMinutes:240,escalateAfter:3,readRetryMinRemainingMs:60000,...config.inboxRetry};
  const i=config.inboxRetry;
  if(!Object.values(i).every(v=>Number.isInteger(v)&&v>0)||i.maxMinutes<i.baseMinutes||i.maxMinutes>1440)throw Error('收件箱退避配置无效');
  config.businessHealth={failureCycles:3,minReadFailures:3,...config.businessHealth};
  if(!Object.values(config.businessHealth).every(v=>Number.isInteger(v)&&v>0))throw Error('业务健康配置无效');
  return config;
}

// One browser chat surface, with transaction-level reentrancy for first contact.
export class PriorityMutex {
  constructor() { this.queue = []; this.active = false; this.owner = new AsyncLocalStorage(); }
  run(task, priority = 0) {
    const owner = this.owner.getStore();
    if (owner?.active) return Promise.resolve().then(task);
    return new Promise((resolve,reject) => {
      this.queue.push({task,priority,resolve,reject});
      this.queue.sort((a,b)=>b.priority-a.priority);
      this.drain();
    });
  }
  drain() {
    if (this.active || !this.queue.length) return;
    this.active=true;
    const item=this.queue.shift(), owner={active:true};
    this.owner.run(owner,async()=>{
      try { item.resolve(await item.task()); } catch(error) { item.reject(error); }
      finally { owner.active=false; this.active=false; this.drain(); }
    });
  }
}

export function coordinatedChat(chat, mutex, priority, check = () => {}) {
  return new Proxy(chat, {
    get(target,key) {
      const value=target[key];
      if(typeof value!=='function')return value;
      // Methods execute on the raw object: nested UI operations keep the same lock.
      return (...args)=>mutex.run(()=>{check();return value.apply(target,args);},priority);
    }
  });
}

export async function runParallelLanes(lanes, onFailure = () => {}, parallel = true) {
  if(!parallel) {
    for(const [name,run] of Object.entries(lanes)){
      try { await run(); } catch(error) { onFailure(name,error);throw error; }
    }
    return;
  }
  // Drain both lanes before disconnecting CDP or committing the final cycle.
  const results=await Promise.allSettled(Object.entries(lanes).map(async([name,run])=>{
    try { return await run(); }
    catch(error) { onFailure(name,error); throw error; }
  }));
  const failed=results.find(r=>r.status==='rejected');
  if(failed)throw failed.reason;
}
