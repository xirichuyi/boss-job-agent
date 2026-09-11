import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { ROOT } from "../src/project-root.ts";
import { planSetup, writeSetup } from "../src/config/setup.ts";
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  if (!args[i + 1] || args[i + 1].startsWith("--"))
    throw Error(name + " 缺少参数");
  return args[i + 1];
};
try {
  if (args.includes("--help")) {
    console.log(
      "npm run setup -- [--answers answers.json] [--output 新目录] [--dry-run]\n只生成私密配置；不安装软件、不初始化账本、不启动服务、不发送消息。",
    );
  } else {
    let answers;
    const file = option("--answers");
    if (file) answers = JSON.parse(fs.readFileSync(file, "utf8"));
    else {
      if (!process.stdin.isTTY)
        throw Error("非交互环境请提供 --answers 文件，或在终端运行安装向导");
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        const cities = await rl.question(
          "城市（杭州、深圳、成都、南京，用逗号分隔；留空保留四城）：",
        );
        const salary = await rl.question("月薪下限K（默认11）：");
        const size = await rl.question(
          "公司人数下限（20/100/500/1000/10000，默认500）：",
        );
        const words = await rl.question(
          "岗位关键词（逗号分隔；留空使用默认产品/开发方向）：",
        );
        const resume = await rl.question(
          "BOSS附件简历文件名（默认resume.pdf）：",
        );
        const model = await rl.question(
          "模型名称（留空保留默认；请核实账号权限）：",
        );
        const effort = await rl.question("推理强度（留空保留默认）：");
        const split = (s) =>
          s
            .split(/[,，]/)
            .map((x) => x.trim())
            .filter(Boolean);
        answers = {
          ...(cities ? { cities: split(cities) } : {}),
          ...(salary ? { minimumMonthlySalaryK: Number(salary) } : {}),
          ...(size ? { minimumCompanySize: Number(size) } : {}),
          ...(words ? { keywords: split(words) } : {}),
          ...(resume ? { resumeFile: resume } : {}),
          ...(model ? { model } : {}),
          ...(effort ? { reasoningEffort: effort } : {}),
        };
      } finally {
        rl.close();
      }
    }
    const files = planSetup(answers),
      directory = path.resolve(
        option("--output") || path.join(ROOT, "config/private-local"),
      );
    if (args.includes("--dry-run"))
      console.log(
        JSON.stringify({ output: directory, files, dryRun: true }, null, 2),
      );
    else {
      writeSetup(directory, files);
      const quoted = "'" + directory.replaceAll("'", "'\\''") + "'";
      console.log(
        "配置已生成（首次每轮最多1位新HR）。\nexport BOSS_CONFIG_DIR=" +
          quoted +
          "\n然后运行 npm run doctor；新安装再运行 npm run init。现有账本未修改，真实发送未启用。\n安装 systemd 服务时也需设置同一个 BOSS_CONFIG_DIR。",
      );
    }
  }
} catch (error) {
  console.error("配置向导失败：" + error.message);
  process.exitCode = 1;
}
