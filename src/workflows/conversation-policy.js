import { AGENT } from '../agent-config.js';
export const RESUME_FILE = AGENT.resumeFile;
export function isResumeReceipt(m) {
  return /您的附件简历[\s\S]*已发送给Boss|对方已查看了您的附件简历/.test(m.text) && m.system === true;
}
export function conversationState(history) {
  const messages = history.messages;
  const human = messages.filter(m => !m.system && !/^你与该职位竞争者/.test(m.text));
  const latest = human.at(-1);
  const request = [...messages].reverse().find(m => !m.self && !m.system && /简历/.test(m.text) && /发|附件|提供|给.*份/.test(m.text));
  const index = request ? messages.indexOf(request) : -1;
  const receipt = messages.slice(index + 1).find(isResumeReceipt);
  const refused = request && /不需要|不用|不要|别发/.test(request.text);
  return { human, latest, receipt, requested: !!request && !refused && latest === request,
    attachment: receipt ? 'already_sent' : request && !refused && latest === request ? 'send_requested' : 'none' };
}
