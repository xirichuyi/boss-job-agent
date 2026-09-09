import { Worker } from 'node:worker_threads';
import { PriorityMutex } from '../task-coordinator.js';

export function createAsyncDecision({root,cycle,progress,check=()=>{},WorkerClass=Worker}) {
  // Serialize provider calls to preserve the existing budget/cooldown accounting;
  // the browser event loop remains free while the worker waits for Codex.
  const queue=new PriorityMutex();
  const run=(mode,args,priority)=>queue.run(()=>new Promise((resolve,reject)=>{
    try { check(); } catch(error) { reject(error);return; }
    const worker=new WorkerClass(new URL('./decision-worker.js',import.meta.url), {
      workerData:{root,cycle,mode,args}, execArgv:[]
    });
    let result, failure, received=false;
    worker.on('message',message=>{
      if(message.type==='progress') {
        try { progress(message.phase,message.details); } catch(error) { failure=error; }
      }
      if(message.type==='result'){received=true;result=message.result;}
      if(message.type==='failure')failure=Object.assign(Error(message.message),{code:message.code,until:message.until});
    });
    worker.on('error',error=>{failure=error;});
    worker.on('exit',code=>{
      if(failure)reject(failure);
      else if(code!==0||!received)reject(Error('模型后台线程退出但没有可靠结果'));
      else resolve(result);
    });
  }),priority);
  const decide=(...args)=>run('single',args,args[2]==='reply'?1:0);
  decide.batch=(...args)=>run('batch',args,0);
  return decide;
}
