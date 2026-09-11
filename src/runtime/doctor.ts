import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export async function diagnose({
  root,
  config,
  offline = false,
  run = spawnSync,
  fetcher = fetch,
}) {
  const checks = [];
  const add = (name, ok, detail, fix = "") =>
    checks.push({
      name,
      status: ok ? "ok" : "error",
      detail,
      fix: ok ? "" : fix,
    });
  add(
    "node",
    Number(process.versions.node.split(".")[0]) >= 24,
    "Node " + process.versions.node,
    "安装 Node.js 24 或更高版本",
  );
  for (const [name, binary, args, fix] of [
    [
      "flock",
      "/usr/bin/flock",
      ["--version"],
      "安装 util-linux（flock 文件锁）",
    ],
    [
      "codex",
      config.codex.binary,
      ["--version"],
      "安装 Codex CLI，并检查 codex.binary 路径",
    ],
    [
      "browser",
      config.browser.binary,
      ["--version"],
      "安装 Chromium/Chrome，并检查 browser.binary 路径",
    ],
  ]) {
    const r = run(binary, args, {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ok = r.status === 0;
    add(
      name,
      Boolean(ok),
      ok ? "可执行且版本检查通过" : "程序缺失、版本不满足或执行失败",
      fix,
    );
  }
  for (const [name, file, fix] of [
    [
      "profile",
      "candidate-profile.md",
      "复制 examples/candidate-profile.md 并填写真实资料",
    ],
    ["state", "memory/harness.sqlite", "执行 npm run init；不要覆盖已有账本"],
  ]) {
    const location = path.join(root, file),
      exists = fs.existsSync(location);
    let ok = exists;
    if (exists && name === "profile") {
      const text = fs.readFileSync(location, "utf8");
      ok =
        Boolean(text.trim()) &&
        !/请替换|填写自己的姓名|禁止把示例当真实经历/.test(text);
    }
    add(name, ok, ok ? "已配置" : "缺失或仍为示例", fix);
    if (exists && fs.statSync(location).mode & 0o077)
      checks.push({
        name: name + "-permissions",
        status: "warning",
        detail: "私密文件允许其他用户读取",
        fix: "将此文件权限设为 0600，目录设为 0700",
      });
  }
  for (const warning of config.warnings)
    checks.push({
      name: "legacy-config",
      status: "warning",
      detail: warning,
      fix: "删除已弃用字段，只修改实际配置源",
    });
  if (!offline) {
    try {
      const r = await fetcher(
        config.browser.cdpUrl.replace(/\/$/, "") + "/json/list",
        { signal: AbortSignal.timeout(5000) },
      );
      if (!r.ok) throw Error("HTTP");
      const targets = await r.json();
      const has = (p) =>
        targets.some((t) => {
          try {
            const u = new URL(t.url);
            return (
              t.type === "page" &&
              u.origin === "https://www.zhipin.com" &&
              u.pathname === p
            );
          } catch {
            return false;
          }
        });
      add(
        "jobs-tab",
        has("/web/geek/jobs"),
        "岗位页标签检查",
        "打开已登录的 BOSS 岗位搜索页",
      );
      add(
        "chat-tab",
        has("/web/geek/chat"),
        "聊天页标签检查",
        "打开 BOSS 聊天页",
      );
    } catch {
      add(
        "cdp",
        false,
        "无法读取本机浏览器调试接口",
        "启动浏览器；核对 CDP 地址、端口或 SSH 隧道",
      );
    }
  }
  checks.push({
    name: "manual-verification",
    status: "warning",
    detail: "尚未验证扫码状态、模型账号权限、附件文件名和平台真实发送",
    fix: "完成扫码后执行 npm run health；人工核对资料、筛选和附件。此命令不调用模型或发送消息",
  });
  return {
    ok: !checks.some((c) => c.status === "error"),
    scope: offline ? "offline" : "local-browser-read-only",
    checks,
  };
}
