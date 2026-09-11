import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  validateTelegramSettings,
  telegramSettings,
} from "../src/config/telegram.ts";
import { validateBrowserRuntime } from "../src/config/browser-runtime.ts";
import { BossTools } from "../src/adapters/browser/cdp.ts";
import { ingest } from "../src/adapters/telegram/chat.ts";
import { executionConfig } from "../src/runtime/coordinator.ts";

test("old configs retain defaults; malformed settings fail clearly", () => {
  assert.equal(validateTelegramSettings().pollMs, 3000);
  assert.equal(validateBrowserRuntime().commandTimeoutMs, 20000);
  for (const invalid of [
    null,
    [],
    { pollMs: 0 },
    { pollMs: "3000" },
    { unknown: 1 },
    { updatesPerPoll: 101 },
    { replyRetrySeconds: 1 },
    { answerMaxChars: 4000 },
    { constructor: 1 },
  ])
    assert.throws(() => validateTelegramSettings(invalid));
  for (const invalid of [
    null,
    [],
    { commandTimeoutMs: 12000 },
    { navigationChecks: 101 },
    { connectTimeoutMs: -1 },
    { typo: 1 },
  ])
    assert.throws(() => validateBrowserRuntime(invalid));
});

test("custom config reaches browser adapter, Telegram ingestion and effective execution", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-settings-"));
  const previous = process.env.BOSS_CONFIG_DIR;
  t.after(() => {
    if (previous === undefined) delete process.env.BOSS_CONFIG_DIR;
    else process.env.BOSS_CONFIG_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const config = JSON.parse(
    fs.readFileSync(
      new URL("../config/execution.json", import.meta.url),
      "utf8",
    ),
  );
  config.telegram.questionMaxChars = 3;
  config.telegram.pollMs = 5000;
  config.browser.apiReadTimeoutMs = 7000;
  fs.writeFileSync(path.join(dir, "execution.json"), JSON.stringify(config));
  process.env.BOSS_CONFIG_DIR = dir;
  assert.equal(telegramSettings().pollMs, 5000);
  assert.equal(executionConfig().telegram.questionMaxChars, 3);
  const browser = new BossTools();
  let expression = "";
  browser.call = async (_method, params) => {
    expression = params.expression;
    return { result: { value: {} } };
  };
  await browser.read("/wapi/zpgeek/search/joblist.json");
  assert.match(expression, /AbortSignal.timeout\(7000\)/);
  const state = { queue: [], offset: 0, startedAt: new Date(0).toISOString() };
  ingest(
    state,
    [
      {
        update_id: 1,
        message: {
          text: "abcdef",
          date: 1,
          chat: { id: 1, type: "private" },
          from: { id: 1 },
        },
      },
    ],
    1,
  );
  assert.equal(state.queue[0].text, "abc");
});
