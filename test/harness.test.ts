import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HarnessStore } from "../src/storage/harness.ts";
import { callCodex } from "../src/adapters/model/codex.ts";
test("quota and cycle commit together, and both roll back on failure", () => {
  const s = new HarnessStore(":memory:");
  s.batch([
    ["quota", 3],
    ["cycle", "one"],
  ]);
  assert.throws(() =>
    s.transaction(() => {
      s.put("quota", 6);
      throw Error("crash");
    }),
  );
  assert.equal(s.read("quota"), 3);
  assert.equal(s.read("cycle"), "one");
  s.close();
});
test("intent and ledger survive close/reopen consistently", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-test-"));
  const file = dir + "/state.sqlite";
  const s = new HarnessStore(file);
  s.batch([
    ["intent", "unknown"],
    ["ledger", "unknown"],
  ]);
  s.close();
  const r = new HarnessStore(file);
  assert.equal(r.read("intent"), r.read("ledger"));
  r.close();
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
test("duplicate request admits once and shares one cycle", () => {
  const s = new HarnessStore(":memory:");
  s.enqueue("telegram", "same");
  s.enqueue("telegram", "same");
  s.enqueue("manual", "different");
  assert.equal(s.pending().length, 2);
  s.admit(
    [
      ["quota", 3],
      ["cycle", "one"],
    ],
    "one",
  );
  assert.equal(s.pending().length, 0);
  s.enqueue("telegram", "same");
  assert.equal(s.pending().length, 0);
  s.close();
});
test("only one live executor; dead executor can be replaced; old token cannot release new", () => {
  const s = new HarnessStore(":memory:");
  const a = s.acquire(1, () => true);
  assert.ok(a);
  assert.equal(
    s.acquire(2, () => true),
    null,
  );
  const b = s.acquire(2, () => false);
  assert.ok(b);
  s.release(a);
  assert.equal(s.owns(b), true);
  s.release(b);
  assert.equal(s.owns(b), false);
  s.close();
});
test("model adapter refuses wrong model and enforces timeout", () => {
  assert.throws(() => callCodex(["-m", "other", "read-only"], {}));
  const r = callCodex(
    ["-m", "gpt-5.6-luna", "read-only"],
    {},
    (bin, args, options) => {
      assert.deepEqual(args.slice(0, 2), [
        "-c",
        'model_reasoning_effort="high"',
      ]);
      return options;
    },
  );
  assert.equal(r.timeout, 120000);
});
