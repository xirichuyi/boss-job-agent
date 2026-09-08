import { VisibleTools } from '../src/visible-tools.js';
const b = new VisibleTools();
try {
  await b.connectView('jobs');
  await b.guard();
  const ready = await b.evaluate(`!!document.querySelector('.cur-city-label') && !!document.querySelector('.job-card-wrap')`);
  if (!ready) throw new Error('岗位页未就绪');
  console.log('ready');
} catch { process.exitCode = 1; }
finally { b.disconnect(); }
