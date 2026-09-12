import { desktopConfig } from "../src/config/desktop.ts";
const browser = desktopConfig();
const url = new URL(browser.cdpUrl);
if (url.protocol !== "http:" || !url.port || url.pathname !== "/")
  throw Error("内置桌面启动器要求带端口的本机HTTP CDP根地址");
const ports = [Number(url.port), browser.vncPort, browser.webPort];
if (new Set(ports).size !== 3) throw Error("CDP/VNC/noVNC端口不能冲突");
console.log([browser.binary, ...ports].join("\n"));
