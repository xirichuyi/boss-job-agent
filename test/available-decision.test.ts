import test from "node:test";
import assert from "node:assert/strict";
import { availableDecision } from "../src/application/available-decision.ts";

test("cooldown defers generation without calling provider and does not mark history handled", async () => {
  const f = () => assert.fail("provider");
  f.batch = f;
  const wrapped = availableDecision(f, {
    cooldown: () => ({ until: "later" }),
  });
  const decision = await wrapped({}, {}, "reply");
  assert.equal(decision.action, "skip");
  assert.equal(decision.retryable, true);
  assert.equal((await wrapped.batch([{}, {}])).length, 2);
});
test("cooldown occurring mid-cycle does not abort independent workflows", async () => {
  const f = async () => {
    throw Object.assign(Error("limit"), {
      code: "MODEL_COOLDOWN",
      until: "later",
    });
  };
  f.batch = f;
  let deferred = 0;
  const wrapped = availableDecision(f, {
    cooldown: () => null,
    onDeferred: () => deferred++,
  });
  assert.equal((await wrapped({}, {}, "reply")).retryable, true);
  assert.equal(deferred, 1);
});
test("other provider errors remain visible", async () => {
  const f = async () => {
    throw Error("unexpected");
  };
  const wrapped = availableDecision(f, { cooldown: () => null });
  await assert.rejects(wrapped(), /unexpected/);
});
