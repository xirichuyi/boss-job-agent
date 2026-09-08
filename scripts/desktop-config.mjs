import { AGENT } from '../src/agent-config.js';
const url = new URL(AGENT.browser.cdpUrl);
if (url.protocol !== 'http:' || !url.port || url.pathname !== '/') throw Error('内置桌面启动器要求带端口的本机HTTP CDP根地址');
const ports = [Number(url.port), AGENT.browser.vncPort, AGENT.browser.webPort];
if (new Set(ports).size !== 3) throw Error('CDP/VNC/noVNC端口不能冲突');
console.log([AGENT.browser.binary, ...ports].join('\n'));
