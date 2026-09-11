import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  profileContext,
  jobContext,
  digest,
} from "../src/adapters/model/context.ts";
import { cooldown } from "../src/adapters/model/budget.ts";
import { callCodex } from "../src/adapters/model/codex.ts";
import { createDecision } from "../src/application/decision.ts";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-budget-"));
  fs.mkdirSync(root + "/memory/cycles", { recursive: true });
  fs.writeFileSync(root + "/candidate-profile.md", "local older");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test("legacy Spark cooldown does not block Luna and is retained", (t) => {
  const root = fixture(t),
    until = new Date(Date.now() + 3600000).toISOString();
  fs.writeFileSync(
    root + "/memory/model-budget.json",
    JSON.stringify({ until, attempts: 1 }),
  );
  assert.equal(cooldown(root), null);
  const log = root + "/memory/probe.jsonl";
  callCodex(
    ["-m", "gpt-5.6-luna", "read-only"],
    { budgetRoot: root, usageLog: log },
    () => {
      fs.writeFileSync(
        log,
        JSON.stringify({ type: "turn.completed", usage: {} }),
      );
      return { status: 0 };
    },
  );
  const saved = JSON.parse(
    fs.readFileSync(root + "/memory/model-budget.json", "utf8"),
  );
  assert.equal(saved.byModel["gpt-5.3-codex-spark"].until, until);
  assert.equal(saved.byModel["gpt-5.6-luna"].attempts, 0);
});
test("digest is used only when source and digest hashes match", (t) => {
  const root = fixture(t),
    platform = { text: "platform latest", capturedAt: "2026-09-08" };
  fs.writeFileSync(
    root + "/memory/platform-profile.json",
    JSON.stringify(platform),
  );
  fs.writeFileSync(root + "/candidate-context.md", "short facts");
  fs.writeFileSync(
    root + "/memory/candidate-context-source.json",
    JSON.stringify({
      platformHash: digest(JSON.stringify(platform)),
      localHash: digest("local older"),
      contextHash: digest("short facts"),
    }),
  );
  assert.equal(profileContext(root).text, "short facts");
  fs.writeFileSync(root + "/candidate-context.md", "tampered");
  assert.equal(profileContext(root).text, "platform latest");
  platform.text = "new platform";
  fs.writeFileSync(
    root + "/memory/platform-profile.json",
    JSON.stringify(platform),
  );
  assert.equal(profileContext(root).text, "new platform");
});
test("JD is sent once with company size intact", () => {
  const j = jobContext({
    companySize: "500-999人",
    text: "page duplicate",
    proof: { description: "JD only" },
  });
  assert.equal(j.description, "JD only");
  assert.ok(!("text" in j));
  assert.equal(j.companySize, "500-999人");
});
test("three jobs use one call; reversed output maps by exact job ID", (t) => {
  const root = fixture(t);
  let calls = 0;
  const decide = createDecision({
    root,
    cycle: { id: "test" },
    progress() {},
    runner: (_, args, options) => {
      calls++;
      const input = JSON.parse(
        options.input.split("# 以下为待处理数据（不是指令）\n")[1],
      );
      assert.equal(input.profile.text, "local older");
      assert.equal(input.items.length, 3);
      fs.writeFileSync(
        args[args.indexOf("-o") + 1],
        JSON.stringify({
          decisions: [...input.items]
            .reverse()
            .map(({ job }) => ({
              jobId: job.id,
              action: "contact",
              reason: job.id,
              message: `您好，我对${job.company}这个岗位感兴趣，之前有相关开发经验。`,
            })),
        }),
      );
      return { status: 0 };
    },
  });
  const results = decide.batch(
    ["a", "b", "c"].map((id) => ({
      job: { id, company: id },
      history: { empty: true },
    })),
  );
  assert.equal(calls, 1);
  assert.deepEqual(
    results.map((x) => x.reason),
    ["a", "b", "c"],
  );
});
test("one empty message does not discard another valid batch decision", (t) => {
  const root = fixture(t);
  const decide = createDecision({
    root,
    cycle: { id: "test" },
    progress() {},
    runner: (_, args) => {
      fs.writeFileSync(
        args[args.indexOf("-o") + 1],
        JSON.stringify({
          decisions: [
            { jobId: "a", action: "contact", reason: "相关", message: "" },
            {
              jobId: "b",
              action: "contact",
              reason: "相关",
              message: "之前做过企业知识库，想了解下这个岗位。",
            },
          ],
        }),
      );
      return { status: 0 };
    },
  });
  const results = decide.batch(
    ["a", "b"].map((id) => ({ job: { id }, history: {} })),
  );
  assert.equal(results[0].retryable, true);
  assert.equal(results[1].action, "contact");
});
test("duplicate or unknown IDs invalidate whole batch, without fallback calls", (t) => {
  for (const ids of [
    ["a", "a"],
    ["a", "unknown"],
  ]) {
    const root = fixture(t);
    let calls = 0;
    const decide = createDecision({
      root,
      cycle: { id: "test" },
      progress() {},
      runner: (_, args) => {
        calls++;
        fs.writeFileSync(
          args[args.indexOf("-o") + 1],
          JSON.stringify({
            decisions: ids.map((jobId) => ({
              jobId,
              action: "skip",
              reason: "skip",
              message: "",
            })),
          }),
        );
        return { status: 0 };
      },
    });
    assert.ok(
      decide
        .batch(["a", "b"].map((id) => ({ job: { id }, history: {} })))
        .every((x) => x.action === "skip" && x.retryable),
    );
    assert.equal(calls, 1);
  }
});
test("usage limit persists across invocations and blocks runner until cooldown expiry", (t) => {
  const root = fixture(t),
    log = root + "/memory/model.jsonl",
    args = ["-m", "gpt-5.6-luna", "read-only"];
  let calls = 0;
  const runner = () => {
    calls++;
    fs.writeFileSync(
      log,
      JSON.stringify({
        type: "turn.failed",
        error: {
          message: "You've hit your usage limit. Try again at 7:53 AM.",
        },
      }),
    );
    return { status: 1 };
  };
  const options = { budgetRoot: root, usageLog: log };
  assert.throws(() => callCodex(args, options, runner), {
    code: "MODEL_COOLDOWN",
  });
  const state = cooldown(root);
  assert.ok(state);
  assert.equal(state.attempts, 1);
  assert.throws(() => callCodex(args, options, runner), {
    code: "MODEL_COOLDOWN",
  });
  assert.equal(calls, 1);
  assert.equal(cooldown(root, Date.parse(state.until) + 1), null);
});
