import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CODE_ROOT } from "../src/project-root.ts";
import { planSetup, writeSetup } from "../src/config/setup.ts";

const usage =
  "npm run onboard -- --answers answers.json --profile resume.md --config 新配置目录 --data 新数据目录";
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log(
    usage + "\n只初始化新安装；不安装系统软件、不启动服务、不发送消息。",
  );
} else {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !["--answers", "--profile", "--config", "--data"].includes(key) ||
      !value ||
      value.startsWith("--") ||
      options.has(key)
    )
      throw Error(usage);
    options.set(key, value);
  }
  if (options.size !== 4) throw Error(usage);
  const directory = path.resolve(options.get("--config")!);
  const data = path.resolve(options.get("--data")!);
  const nested = (a: string, b: string) =>
    a === b || b.startsWith(a + path.sep);
  if (nested(directory, data) || nested(data, directory))
    throw Error("配置和数据必须使用互不包含的独立新目录");
  for (const target of [directory, data])
    if (fs.existsSync(target))
      throw Error("目标已存在，拒绝覆盖或重新初始化：" + target);
  const files = planSetup(
    JSON.parse(fs.readFileSync(options.get("--answers")!, "utf8")),
  );
  const profile = fs.readFileSync(options.get("--profile")!, "utf8");
  if (!profile.trim()) throw Error("简历文档为空");
  // All input checks precede writes. Partial failures are retained for inspection.
  writeSetup(directory, files);
  fs.mkdirSync(path.dirname(data), { recursive: true, mode: 0o700 });
  fs.mkdirSync(data, { mode: 0o700 });
  fs.writeFileSync(path.join(data, "candidate-profile.md"), profile, {
    flag: "wx",
    mode: 0o600,
  });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BOSS_CONFIG_DIR: directory,
    BOSS_DATA_DIR: data,
  };
  delete env.BOSS_AGENT_CONFIG;
  delete env.BOSS_JOB_FILTERS_CONFIG;
  delete env.BOSS_AGENT_ROOT;
  const result = spawnSync(
    process.execPath,
    [path.join(CODE_ROOT, "scripts/init.ts")],
    {
      env,
      stdio: "inherit",
      timeout: 30000,
    },
  );
  if (result.status !== 0)
    throw Error(
      "初始化未完成；保留目录供检查，未启用发送：" +
        (result.error?.message || result.status),
    );
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  console.log(
    `新安装已初始化，自动发送关闭。后续终端与服务使用：\nexport BOSS_CONFIG_DIR=${quote(directory)}\nexport BOSS_DATA_DIR=${quote(data)}\n下一步：填写/核对资料 → npm run doctor → 浏览器扫码 → 本人授权。`,
  );
}
