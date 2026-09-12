import fs from "node:fs";
import { configFile } from "./files.ts";

export interface BrowserRuntimeSettings {
  discoveryTimeoutMs: number;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  apiReadTimeoutMs: number;
  navigationChecks: number;
  navigationPollMs: number;
  viewTimeoutMs: number;
  viewPollMs: number;
  contactSearchDelayMs: number;
  conversationScrollDelayMs: number;
  controlTimeoutMs: number;
  receiptTimeoutMs: number;
}
// One shipped defaults file; private/older configs override only supplied keys.
const defaults: BrowserRuntimeSettings = Object.freeze(
  JSON.parse(
    fs.readFileSync(
      new URL("../../config/execution.json", import.meta.url),
      "utf8",
    ),
  ).browser,
);
export function validateBrowserRuntime(
  value: unknown = {},
): BrowserRuntimeSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("浏览器运行配置必须是对象");
  for (const key of Object.keys(value))
    if (!Object.hasOwn(defaults, key))
      throw Error(`未知浏览器运行配置：${key}`);
  const settings = { ...defaults, ...value };
  for (const [key, number] of Object.entries(settings))
    if (!Number.isSafeInteger(number) || number <= 0 || number > 120000)
      throw Error(`浏览器运行配置 ${key} 超出允许范围`);
  if (
    settings.navigationChecks > 100 ||
    settings.navigationPollMs > 10000 ||
    settings.apiReadTimeoutMs >= settings.commandTimeoutMs
  )
    throw Error("浏览器轮询配置无效，且 API 超时必须小于 CDP 命令超时");
  return settings;
}
export function browserRuntimeSettings(): BrowserRuntimeSettings {
  const execution = JSON.parse(
    fs.readFileSync(configFile("execution"), "utf8"),
  );
  return validateBrowserRuntime(execution.browser);
}
