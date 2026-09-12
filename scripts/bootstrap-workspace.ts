import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { desktopConfig } from "../src/config/desktop.ts";
import {
  workspace,
  initialDesktop,
  writePrivate,
} from "../src/installation/workspace.ts";

const [directory, browser, codex] = process.argv.slice(2);
if (!directory || !browser) throw Error("missing bootstrap arguments");
const { state } = workspace(
  directory,
  !["--health", "--ports"].includes(browser),
);
initialDesktop(state);
if (browser === "--ports") {
  const desktop = desktopConfig({ BOSS_DESKTOP_CONFIG: state.desktop });
  for (const port of [
    Number(new URL(desktop.cdpUrl).port),
    desktop.vncPort,
    desktop.webPort,
  ]) {
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer();
      server.once("error", () =>
        reject(
          Error(`端口${port}已占用；修改 desktop.json，不自动终止其他进程`),
        ),
      );
      server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
    });
  }
  if (fs.existsSync("/tmp/.X11-unix/X99"))
    throw Error("X11 DISPLAY 99已占用；请人工调整桌面服务 DISPLAY_NUMBER");
} else if (browser === "--health") {
  const desktop = desktopConfig({ BOSS_DESKTOP_CONFIG: state.desktop });
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const [cdp, web] = await Promise.all([
        fetch(desktop.cdpUrl + "/json/version", {
          signal: AbortSignal.timeout(1500),
        }),
        fetch(`http://127.0.0.1:${desktop.webPort}/vnc.html`, {
          signal: AbortSignal.timeout(1500),
        }),
      ]);
      if (cdp.ok && web.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready)
    throw Error(
      "桌面未就绪；检查 journalctl -u job-agent-desktop 和工作区 browser/logs，不要关闭 sandbox",
    );
  console.log("CDP 和 noVNC 已就绪；这不代表 BOSS 已登录或发送已授权");
} else {
  if (!path.isAbsolute(browser) || !codex || !path.isAbsolute(codex))
    throw Error("binary paths must be absolute");
  const binding = path.join(state.root, "bootstrap-paths.json");
  const paths = { browserBinary: browser, codexBinary: codex };
  if (fs.existsSync(binding)) {
    if (
      JSON.stringify(JSON.parse(fs.readFileSync(binding, "utf8"))) !==
      JSON.stringify(paths)
    )
      throw Error("已有安装程序路径改变，请人工核对，拒绝自动改业务配置");
  } else {
    if (fs.existsSync(state.config))
      throw Error("该工作区已有手动配置，拒绝自动接管或改写浏览器路径");
    const desktop = JSON.parse(fs.readFileSync(state.desktop, "utf8"));
    writePrivate(state.desktop, { ...desktop, binary: browser });
    writePrivate(binding, paths);
  }
  console.log("工作区已准备；保留既有资料和授权状态");
}
