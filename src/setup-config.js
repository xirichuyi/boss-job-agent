import fs from 'node:fs';
import path from 'node:path';
import { configFile } from './config-files.js';

export function planSetup(answers) {
  const keys=['cities','minimumMonthlySalaryK','minimumCompanySize','keywords','resumeFile','model','reasoningEffort'];
  if(!answers||Array.isArray(answers)||typeof answers!=='object'||Object.keys(answers).some(k=>!keys.includes(k)))throw Error('答案文件包含未知字段或格式错误；参见 examples/setup-answers.json');
  const files=Object.fromEntries(['agent','job-filters','model','execution'].map(n=>[n,JSON.parse(fs.readFileSync(configFile(n,{}),'utf8'))]));
  const catalog=files['job-filters'].cities;
  const names=answers.cities || catalog.map(c=>c.name);
  if(!Array.isArray(names)||!names.length||new Set(names).size!==names.length||names.some(n=>!catalog.some(c=>c.name===n)))throw Error('请选择城市列表中的名称；自定义城市可在生成后配置并验证平台编码');
  const min=answers.minimumMonthlySalaryK ?? files['job-filters'].minimumMonthlySalaryK;
  if(!Number.isFinite(min)||min<0)throw Error('月薪下限必须是非负数字，单位K');
  const size=answers.minimumCompanySize ?? files.agent.search.minimumCompanySize;
  const codes={20:[302,303,304,305,306],100:[303,304,305,306],500:[304,305,306],1000:[305,306],10000:[306]};
  if(!codes[size])throw Error('公司规模下限支持20、100、500、1000、10000');
  const words=answers.keywords || files.agent.search.keywords;
  if(!Array.isArray(words)||!words.length||words.some(w=>typeof w!=='string'||!w.trim()||w.length>40))throw Error('岗位关键词无效');
  const resume=answers.resumeFile || files.agent.resumeFile;
  if(typeof resume!=='string'||/[\/\\\r\n]/.test(resume))throw Error('附件名只能填写平台文件名，不能填写路径');
  const model=answers.model || files.model.model, effort=answers.reasoningEffort || files.model.reasoningEffort;
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)||!['none','minimal','low','medium','high','xhigh','max'].includes(effort))throw Error('模型或推理强度无效');
  files['job-filters'].cities=catalog.filter(c=>names.includes(c.name));
  files['job-filters'].minimumMonthlySalaryK=min;
  // Include all bands intersecting the lower-bound requirement, then verify exact salary locally.
  files['job-filters'].nativeSalaryCodes=[{code:402,max:3},{code:403,max:5},{code:404,max:10},{code:405,max:20},{code:406,max:50},{code:407,max:Infinity}].filter(b=>b.max>=min).map(b=>b.code);
  files.agent.search.minimumCompanySize=size;files.agent.search.nativeScaleCodes=codes[size];
  files.agent.search.keywords=words;files.agent.resumeFile=resume;files.agent.schedule.perRun=1;
  files.model={model,reasoningEffort:effort};
  return files;
}
export function writeSetup(directory,files) {
  if(fs.existsSync(directory))throw Error('目标目录已存在，拒绝覆盖：'+directory);
  fs.mkdirSync(path.dirname(directory),{recursive:true,mode:0o700});
  fs.mkdirSync(directory,{mode:0o700});
  for(const [name,value] of Object.entries(files))fs.writeFileSync(path.join(directory,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
}
