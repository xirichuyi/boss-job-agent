import { AGENT } from '../src/agent-config.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT } from '../src/project-root.js';
import { HarnessStore } from '../src/harness-store.js';

const memory = path.join(ROOT, 'memory');
fs.mkdirSync(memory, { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(memory, 'cycles'), { recursive: true, mode: 0o700 });
const db = path.join(memory, 'harness.sqlite');
// Never overwrite a live ledger or import an old account's state.
if (fs.existsSync(db)) throw Error('已有数据库，初始化已拒绝：不会覆盖账本');
if (fs.readdirSync(memory).some(f => f !== 'cycles') || fs.readdirSync(path.join(memory, 'cycles')).length) throw Error('memory 非空，请先核查旧状态；不要直接覆盖');
fs.closeSync(fs.openSync(db, 'wx', 0o600)); // Atomic exclusion between competing installers.
const store = new HarnessStore(db);
try {
  store.batch([
    ['schedule.json', { enabled: false, automationReady: false, threadId: randomUUID(), timezone: 'Asia/Shanghai', phase: '安装完成，等待本人配置并授权启用' }],
    ['maintenance.json', { until: null }],
    ['outreach-ledger.json', { contacts: [] }]
  ]);
  console.log('初始化完成。自动发送关闭；不会访问浏览器、调用模型或联系 HR。');
} finally { store.close(); }
