import fs from "node:fs";
import { configFile } from "./files.ts";

// Defaults support existing installations; public execution.json exposes every knob.
const defaults = {
  pollMs: 3000,
  requestTimeoutMs: 10000,
  updatesPerPoll: 50,
  historyEntries: 50,
  answerMaxChars: 3500,
  questionMaxChars: 8000,
  alertReasonMaxChars: 350,
  alertsPerFlush: 1,
  replyRetryMinSeconds: 30,
  replyRetrySeconds: 60,
  alertRetryMinSeconds: 60,
  alertRetrySeconds: 300,
};
export type TelegramSettings = typeof defaults;

export function validateTelegramSettings(
  value: unknown = {},
): TelegramSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Telegram 配置必须是对象");
  for (const key of Object.keys(value))
    if (!Object.hasOwn(defaults, key))
      throw Error(`未知 Telegram 配置字段：${key}`);
  const settings = { ...defaults, ...value };
  for (const [key, number] of Object.entries(settings))
    if (!Number.isSafeInteger(number) || number <= 0)
      throw Error(`Telegram 配置 ${key} 必须是正整数`);
  if (
    settings.pollMs < 1000 ||
    settings.pollMs > 300000 ||
    settings.requestTimeoutMs > 60000 ||
    settings.updatesPerPoll > 100 ||
    settings.answerMaxChars > 3500 ||
    settings.questionMaxChars > 32000 ||
    settings.alertReasonMaxChars > 1000 ||
    settings.historyEntries > 1000 ||
    settings.alertsPerFlush > 10 ||
    settings.replyRetrySeconds < settings.replyRetryMinSeconds ||
    settings.alertRetrySeconds < settings.alertRetryMinSeconds ||
    Math.max(settings.replyRetrySeconds, settings.alertRetrySeconds) > 86400
  )
    throw Error("Telegram 配置超出允许范围或重试间隔小于最小值");
  return settings;
}

export function telegramSettings(): TelegramSettings {
  const execution = JSON.parse(
    fs.readFileSync(configFile("execution"), "utf8"),
  );
  return validateTelegramSettings(execution.telegram);
}
