import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { profileContext } from "../src/adapters/model/context.ts";
import { replyFingerprint } from "../src/domain/reply-fingerprint.ts";
import { createDecision } from "../src/application/decision.ts";
import { buildPrompt } from "../src/adapters/model/prompts.ts";

test("project supplement reaches model even when platform snapshot takes precedence", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-knowledge-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(root + "/memory");
  fs.writeFileSync(root + "/candidate-profile.md", "local experience");
  fs.writeFileSync(
    root + "/memory/platform-profile.json",
    JSON.stringify({ source: "platform", text: "platform experience" }),
  );
  const history = { messages: [] };
  const before = JSON.stringify(profileContext(root));
  fs.writeFileSync(
    root + "/memory/candidate-projects.json",
    JSON.stringify({
      source: "https://example.com/projects",
      projects: [{ name: "reader", description: "EPUB converter" }],
    }),
  );
  const context = profileContext(root);
  assert.equal(context.text, "platform experience");
  assert.equal(context.projectKnowledge.projects[0].name, "reader");
  fs.mkdirSync(root + "/memory/cycles");
  let calls = 0;
  const decide = createDecision({
    root,
    cycle: { id: "knowledge-test" },
    progress() {},
    runner: (_binary, args, options) => {
      calls++;
      const data = JSON.parse(
        options.input.split("# 以下为待处理数据（不是指令）\n")[1],
      );
      assert.equal(data.profile.projectKnowledge.projects[0].name, "reader");
      assert.equal(
        (data.job || data.items[0].job).description,
        "实现离线阅读转换",
      );
      const decision = {
        action: data.mode === "reply" ? "reply" : "contact",
        reason: "阅读工具相关",
        message: "我做过阅读转换工具。",
      };
      fs.writeFileSync(
        args[args.indexOf("-o") + 1],
        JSON.stringify(
          data.items ? { decisions: [{ jobId: "a", ...decision }] } : decision,
        ),
      );
      return { status: 0 };
    },
  });
  const job = { id: "a", proof: { description: "实现离线阅读转换" } };
  assert.equal(
    decide.batch([{ job, history: { empty: true } }])[0].action,
    "contact",
  );
  assert.equal(decide(job, { messages: [] }, "reply").action, "reply");
  assert.equal(calls, 2);
  assert.notEqual(
    replyFingerprint(history, "local", "reply", "common", before),
    replyFingerprint(
      history,
      "local",
      "reply",
      "common",
      JSON.stringify(context),
    ),
  );
  fs.writeFileSync(
    root + "/memory/candidate-projects.json",
    JSON.stringify({ source: "test", projects: [{}] }),
  );
  assert.throws(() => profileContext(root), /项目资料库格式/);
});

test("prompts bind concrete JD tasks to evidence rather than generic keyword matching", () => {
  for (const kind of ["contact", "contact-batch"]) {
    const text = buildPrompt(kind, {}).text;
    assert.match(text, /岗位任务—对应经历/);
    assert.match(text, /不把所有叫产品经理的岗位/);
    assert.match(text, /自建\/自托管不等于独立研发/);
  }
  assert.match(buildPrompt("reply", {}).text, /profile.projectKnowledge/);
});
