import { desktopConfig } from "../config/desktop.ts";
import { runtimeEnv, configOf } from "./workspace.ts";

export async function checkDesktop(state) {
  const config = desktopConfig(runtimeEnv(state));
  let configured;
  try {
    configured = configOf(state).agent.browser;
  } catch {}
  if (
    configured &&
    ["binary", "cdpUrl", "vncPort", "webPort"].some(
      (key) => configured[key] !== config[key],
    )
  )
    throw Error("桌面与业务浏览器配置不一致，请重新configure同步后再检查");
  const result = await fetch(config.cdpUrl.replace(/\/$/, "") + "/json/list", {
    signal: AbortSignal.timeout(5000),
  });
  if (!result.ok) throw Error("浏览器接口不可达");
  const pages = (await result.json()).filter((t) => {
    try {
      const url = new URL(t.url);
      return (
        t.type === "page" &&
        url.origin === "https://www.zhipin.com" &&
        ["/web/geek/jobs", "/web/geek/chat"].includes(url.pathname)
      );
    } catch {
      return false;
    }
  });
  if (!pages.length) throw Error("请先扫码，并打开BOSS岗位页或聊天页");
  const wsURL = new URL(pages[0].webSocketDebuggerUrl);
  if (
    wsURL.protocol !== "ws:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(wsURL.hostname)
  )
    throw Error("拒绝非本机CDP会话");
  const socket = new WebSocket(wsURL);
  const loggedIn = await new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(Error("浏览器登录检查超时"));
    }, 10000);
    const finish = (value: boolean) => {
      clearTimeout(timer);
      socket.close();
      resolve(value);
    };
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression: `(()=>{const text=document.body?.innerText||'';return !/安全验证|异常访问|访问受限|扫码登录|人机验证|拖动滑块/.test(text)&&!!document.querySelector('.job-card-wrap,.boss-search-input,.friend-content')})()`,
            returnByValue: true,
          },
        }),
      );
    socket.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data));
        if (m.id === 1) finish(m.result?.result?.value === true);
      } catch {
        finish(false);
      }
    };
    socket.onerror = () => finish(false);
  });
  if (!loggedIn)
    throw Error("未确认BOSS登录，或需要人工验证；页面可达不等于已登录");
  return { loggedIn: true, inspectedAt: new Date().toISOString() };
}
