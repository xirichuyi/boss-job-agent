import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAsyncDecision } from "../src/application/async-decision.ts";
test("real TS model worker loads with native Node, without making a provider call", async () => {
  const decide = createAsyncDecision({
    root: "/unused",
    cycle: { id: "no-send" },
    progress: () => assert.fail("empty batch must not call model"),
  });
  assert.deepEqual(await decide.batch([]), []);
});
test("supervisor does not depend on application or browser adapters", () => {
  for (const file of ["scheduler", "process-supervisor"]) {
    const source = fs.readFileSync(
      new URL("../src/runtime/" + file + ".ts", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:application|adapters)\//);
  }
});
