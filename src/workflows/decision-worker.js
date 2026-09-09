import { parentPort, workerData } from 'node:worker_threads';
import { createDecision } from './decision.js';

try {
  const { root, cycle, mode, args }=workerData;
  const decide=createDecision({root,cycle,progress:(phase,details)=>parentPort.postMessage({type:'progress',phase,details})});
  const result=mode==='batch'?decide.batch(...args):decide(...args);
  parentPort.postMessage({type:'result',result});
} catch(error) {
  parentPort.postMessage({type:'failure',message:error.message,code:error.code,until:error.until});
} finally { parentPort.close(); }
