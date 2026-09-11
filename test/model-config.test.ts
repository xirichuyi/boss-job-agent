import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadModelConfig,
  MODEL,
  REASONING_EFFORT,
} from "../src/config/model.ts";

test("model and effort come from the single JSON configuration", () => {
  const actual = loadModelConfig();
  assert.equal(MODEL, actual.model);
  assert.equal(REASONING_EFFORT, actual.reasoningEffort);
});
test("configuration supports changes without code edits and fails closed", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-model-config-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "model.json");
  assert.throws(() => loadModelConfig(file));
  fs.writeFileSync(
    file,
    JSON.stringify({ model: "test-model", reasoningEffort: "low" }),
  );
  assert.deepEqual(loadModelConfig(file), {
    model: "test-model",
    reasoningEffort: "low",
  });
  for (const value of [
    {},
    { model: "valid", reasoningEffort: "invalid" },
    null,
  ]) {
    fs.writeFileSync(file, JSON.stringify(value));
    assert.throws(() => loadModelConfig(file));
  }
});
