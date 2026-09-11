import { AGENT } from "../../config/agent.ts";
import fs from "node:fs";
import { atomicJson } from "../../storage/state.ts";
import { telegramSettings } from "../../config/telegram.ts";

export async function telegramCall(token, method, payload, fetcher = fetch) {
  const settings = telegramSettings(); // Invalid configuration is not a network error.
  try {
    const response = await fetcher(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(settings.requestTimeoutMs),
      },
    );
    const result = await response.json();
    if (!result.ok)
      return {
        ok: false,
        code: result.error_code || response.status,
        retryAfter: result.parameters?.retry_after,
      };
    return { ok: true, result: result.result };
  } catch {
    return { ok: false, code: "network_error" };
  } // Never expose request URL/token.
}

export function pairingChat(updates, config, now = Date.now()) {
  if (
    !config.pairCode ||
    !Number.isFinite(Date.parse(config.pairExpiresAt)) ||
    !Number.isFinite(Date.parse(config.pairIssuedAt)) ||
    Date.parse(config.pairExpiresAt) < now
  )
    return null;
  const matches = updates.filter(
    (u) =>
      u.message?.chat?.type === "private" &&
      u.message.from?.id === u.message.chat.id &&
      u.message.text?.replace(/\s/g, "") === `绑定求职${config.pairCode}` &&
      u.message.date * 1000 >= Date.parse(config.pairIssuedAt),
  );
  const ids = [...new Set(matches.map((u) => u.message.chat.id))];
  return ids.length === 1 ? ids[0] : null;
}

export async function flushTelegram(root, fetcher = fetch) {
  const settings = telegramSettings();
  const secretPath = root + "/memory/telegram-secrets.json",
    configPath = root + "/memory/telegram-config.json";
  if (!fs.existsSync(secretPath) || !fs.existsSync(configPath))
    return { state: "unconfigured" };
  const { token } = JSON.parse(fs.readFileSync(secretPath, "utf8"));
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!config.chatId) {
    const updates = await telegramCall(
      token,
      "getUpdates",
      { timeout: 0, limit: 100 },
      fetcher,
    );
    if (!updates.ok) return { state: "pairing_failed", code: updates.code };
    const chat = pairingChat(updates.result, config);
    if (!chat) return { state: "awaiting_pairing" };
    config.chatId = chat;
    config.boundAt = new Date().toISOString();
    delete config.pairCode;
    atomicJson(configPath, config);
  }
  const path = root + "/memory/alerts.json";
  if (!fs.existsSync(path)) return { state: "ready", sent: 0 };
  const alerts = JSON.parse(fs.readFileSync(path, "utf8"));
  let count = 0;
  for (const alert of alerts
    .filter(
      (a) =>
        ["authentication", "contact_recovery_exhausted"].includes(a.kind) &&
        a.status === "open" &&
        !a.telegram?.messageId &&
        !(Date.parse(a.telegram?.retryAt || "") > Date.now()),
    )
    .slice(0, settings.alertsPerFlush)) {
    if (Date.parse(alert.telegram?.retryAt || "") > Date.now()) continue;
    const title =
      alert.kind === "authentication"
        ? "需要你扫码登录或完成人机验证"
        : "求职 Agent 有待处理事项";
    // Keep personal resume/chat contents out of the notification payload.
    const text = `${title}\n${String(alert.reason || "").slice(0, settings.alertReasonMaxChars)}\n告警编号：${alert.id}\n浏览器：${AGENT.browser.publicUrl}`;
    const sent = await telegramCall(
      token,
      "sendMessage",
      {
        chat_id: config.chatId,
        text,
        link_preview_options: { is_disabled: true },
      },
      fetcher,
    );
    alert.telegram = sent.ok
      ? { messageId: sent.result.message_id, sentAt: new Date().toISOString() }
      : {
          errorCode: sent.code,
          retryAt: new Date(
            Date.now() +
              Math.max(
                settings.alertRetryMinSeconds,
                sent.retryAfter || settings.alertRetrySeconds,
              ) *
                1000,
          ).toISOString(),
        };
    if (sent.ok) count++;
    atomicJson(path, alerts);
  }
  return { state: "ready", sent: count };
}
