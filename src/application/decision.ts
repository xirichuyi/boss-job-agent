import fs from "node:fs";
import { readState } from "../storage/harness.ts";
import { callCodex, MODEL } from "../adapters/model/codex.ts";
import { validateDecision } from "../domain/policy.ts";
import { decisionKey } from "../domain/recovery.ts";
import { buildPrompt } from "../adapters/model/prompts.ts";
import {
  profileContext,
  jobContext,
  historyContext,
} from "../adapters/model/context.ts";

export function structuredCall(root, cycle, kind, data, runner) {
  if (!["contact", "reply", "contact-batch"].includes(kind))
    throw Error("不支持的沟通决策");
  const output = `${root}/memory/cycles/${decisionKey(cycle.id, kind)}.decision.json`;
  const prompt = buildPrompt(kind, data);
  fs.writeFileSync(
    output + ".prompt-version.json",
    JSON.stringify({
      kind,
      version: prompt.version,
      inputCharacters: prompt.text.length,
      jobCount: data.items?.length || 1,
    }),
    { mode: 0o600, flag: "wx" },
  );
  const log = fs.openSync(output + ".events.jsonl", "wx", 0o600);
  let run;
  try {
    run = callCodex(
      [
        "-a",
        "never",
        "exec",
        "--ignore-user-config",
        "--sandbox",
        "read-only",
        "-c",
        "features.shell_tool=false",
        "-c",
        "features.apps=false",
        "-c",
        "features.browser_use=false",
        "-c",
        "features.multi_agent=false",
        "-c",
        "features.computer_use=false",
        "-c",
        'web_search="disabled"',
        "-m",
        MODEL,
        "--skip-git-repo-check",
        "--ephemeral",
        "--json",
        "--output-schema",
        root +
          "/scripts/" +
          (kind === "contact-batch" ? "batch-decision" : "decision") +
          ".schema.json",
        "-o",
        output,
        "-C",
        root,
        "-",
      ],
      {
        input: prompt.text,
        cwd: root,
        budgetRoot: root,
        usageLog: output + ".events.jsonl",
        stdio: ["pipe", log, log],
      },
      runner,
    );
  } finally {
    fs.closeSync(log);
  }
  if (run.status !== 0 || !fs.existsSync(output))
    throw Error(MODEL + "决策失败或超时");
  return readState(output);
}

export function createDecision({ root, cycle, progress, runner = undefined }) {
  const decide = function (job, history, mode) {
    if (!["contact", "reply"].includes(mode)) throw Error("未知沟通阶段");
    const data = {
      profile: profileContext(root),
      mode,
      job: jobContext(job),
      history: historyContext(history),
    };
    progress("model_decision", { company: job.company, job: job.title });
    let decision;
    try {
      decision = validateDecision(
        structuredCall(root, cycle, mode, data, runner),
      );
    } catch (e) {
      if (e.code === "MODEL_COOLDOWN") throw e;
      return {
        action: "skip",
        reason: "文案生成/验证不通过：" + e.message,
        message: "",
        retryable: true,
      };
    }
    if (decision.action === "skip") return decision;
    if (decision.action !== mode)
      return { action: "skip", reason: "模型动作与阶段不匹配", message: "" };
    return decision;
  };
  decide.batch = (items) => {
    if (!items.length) return [];
    if (
      items.length > 3 ||
      new Set(items.map((x) => x.job.id)).size !== items.length ||
      items.some((x) => !x.job.id)
    )
      throw Error("批次必须包含1至3个唯一岗位");
    const data = {
      profile: profileContext(root),
      items: items.map(({ job, history }) => ({
        job: jobContext(job),
        history: historyContext(history),
      })),
    };
    progress("model_batch_decision", { count: items.length });
    try {
      const result = structuredCall(root, cycle, "contact-batch", data, runner);
      if (
        !Array.isArray(result?.decisions) ||
        result.decisions.length !== items.length ||
        new Set(result.decisions.map((x) => x.jobId)).size !== items.length ||
        result.decisions.some((x) => !items.some((i) => i.job.id === x.jobId))
      )
        throw Error("批次岗位ID缺失、重复或不匹配");
      return items.map(({ job }) => {
        const value = result.decisions.find((x) => x.jobId === job.id);
        try {
          const decision = validateDecision(value);
          if (!["contact", "skip"].includes(decision.action))
            throw Error("批次动作错误");
          return decision;
        } catch (e) {
          return {
            action: "skip",
            reason: "该岗位输出结构无效，未发送：" + e.message,
            message: "",
            retryable: true,
          };
        }
      });
    } catch (e) {
      if (e.code === "MODEL_COOLDOWN") throw e;
      return items.map(() => ({
        action: "skip",
        reason: "批量决策失败，未发送：" + e.message,
        message: "",
        retryable: true,
      }));
    }
  };
  return decide;
}
