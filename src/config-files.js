import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaults=fileURLToPath(new URL('../config/',import.meta.url));
const overrides={agent:'BOSS_AGENT_CONFIG','job-filters':'BOSS_JOB_FILTERS_CONFIG'};
export function configFile(name, env=process.env) {
  if(!['agent','job-filters','model','execution'].includes(name))throw Error('未知配置文件');
  return path.resolve(env[overrides[name]] || path.join(env.BOSS_CONFIG_DIR || defaults,name+'.json'));
}
