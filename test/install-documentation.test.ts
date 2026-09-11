import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("copyable installation prompt includes runtime paths, authorization and acceptance", () => {
  const readme = fs.readFileSync(
    new URL("../README.md", import.meta.url),
    "utf8",
  );
  const prompt = readme.match(
    /## 交给 Agent 安装的提示词[\s\S]*?```text\n([\s\S]*?)```/,
  )?.[1];
  assert.ok(prompt, "README must contain one copyable installer prompt");
  for (const required of [
    "BOSS_DATA_DIR",
    "BOSS_CONFIG_DIR",
    "BOSS_RPA_DATA_DIR",
    "npm run check",
    "npm run test:install",
    "perRun=1",
    "等待明确授权",
    "送达回执",
    "未验证",
    "SQLite",
    "浏览器桌面也需常驻",
  ])
    assert.ok(
      prompt.includes(required),
      `missing installation requirement: ${required}`,
    );
});

test("deployment instructions match separated data-root support", () => {
  const deployment = fs.readFileSync(
    new URL("../docs/DEPLOYMENT-ACCEPTANCE.md", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    deployment,
    /contact-recovery\.js|仍有子进程从 ROOT\/scripts/,
  );
  assert.match(deployment, /Environment="BOSS_DATA_DIR=/);
  assert.match(deployment, /Environment="BOSS_CONFIG_DIR=/);
});
