import test from "node:test";
import assert from "node:assert/strict";
import { BossTools } from "../src/adapters/browser/cdp.ts";

test("synchronous socket send failure releases pending request immediately", async () => {
  const browser = new BossTools();
  browser.ws = {
    readyState: WebSocket.OPEN,
    send() {
      throw Error("socket closed during send");
    },
  };
  await assert.rejects(
    browser.call("Runtime.evaluate"),
    /socket closed during send/,
  );
  assert.equal(browser.pending.size, 0);
});

test("CDP timeout releases pending request without retrying the command", async () => {
  const browser = new BossTools();
  browser.settings.commandTimeoutMs = 5;
  let sends = 0;
  browser.ws = {
    readyState: WebSocket.OPEN,
    send() {
      sends++;
    },
  };
  await assert.rejects(browser.call("Runtime.evaluate"), /超时/);
  assert.equal(browser.pending.size, 0);
  assert.equal(sends, 1);
});
