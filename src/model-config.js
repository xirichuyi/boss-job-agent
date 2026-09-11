import fs from 'node:fs';
import { configFile } from './config-files.js';

export function loadModelConfig(file = configFile('model')) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value.model)) throw Error('模型配置缺少有效 model');
  if (!['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value.reasoningEffort)) throw Error('模型配置缺少有效 reasoningEffort');
  return Object.freeze({ model: value.model, reasoningEffort: value.reasoningEffort });
}

// One immutable snapshot per process; no hidden model fallback.
const config = loadModelConfig();
export const MODEL = config.model;
export const REASONING_EFFORT = config.reasoningEffort;
