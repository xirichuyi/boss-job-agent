import fs from 'node:fs';
import { ROOT } from '../src/project-root.js';
import { readState } from '../src/harness-store.js';
import { atomicJson } from '../src/schedule-state.js';
import { effectiveConfig } from '../src/effective-config.js';
if (!process.argv.includes('--confirm-real-sends')) throw Error('此操作允许真实联系 HR，须由本人授权后传入 --confirm-real-sends');
effectiveConfig(); // Reject invalid effective filters before authorizing real sends.
const profile = fs.readFileSync(ROOT + '/candidate-profile.md', 'utf8');
if (!profile.trim() || /请替换|填写自己的姓名|禁止把示例当真实经历/.test(profile)) throw Error('请先填写自己的真实资料，不允许使用模板发送');
const file = ROOT + '/memory/schedule.json', config = readState(file);
if (!config) throw Error('请先初始化');
atomicJson(file, { ...config, enabled: true, automationReady: true, phase: '本人已确认真实发送' });
console.log('已授权真实发送；是否立即执行取决于调度服务状态。');
