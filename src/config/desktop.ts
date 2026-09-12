import fs from "node:fs";
import { configFile } from "./files.ts";

export function desktopConfig(env = process.env) {
  // Standalone desktop config can be created before any job/profile configuration.
  const value = env.BOSS_DESKTOP_CONFIG
    ? JSON.parse(fs.readFileSync(env.BOSS_DESKTOP_CONFIG, "utf8"))
    : JSON.parse(fs.readFileSync(configFile("agent", env), "utf8")).browser;
  const url = new URL(value.cdpUrl);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !url.port ||
    url.pathname !== "/" ||
    url.username ||
    url.password
  )
    throw Error("桌面CDP必须是本机HTTP根地址，带端口且不含凭据");
  const ports = [Number(url.port), value.vncPort, value.webPort];
  if (
    ports.some((p) => !Number.isInteger(p) || p < 1024 || p > 65535) ||
    new Set(ports).size !== 3
  )
    throw Error("桌面端口必须是互不冲突的1024–65535整数");
  if (
    typeof value.binary !== "string" ||
    !(value.binary.startsWith("/") || /^[a-zA-Z0-9_.-]+$/.test(value.binary)) ||
    /[\r\n]/.test(value.binary)
  )
    throw Error("浏览器须是有效程序名或绝对路径");
  return {
    binary: value.binary,
    cdpUrl: value.cdpUrl,
    vncPort: value.vncPort,
    webPort: value.webPort,
  };
}
