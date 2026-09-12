import fs from "node:fs";
import path from "node:path";
import { setupForm } from "../src/config/setup-form.ts";
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
    else answers = await setupForm();
    const files = planSetup(answers),
      directory = path.resolve(
        option("--output") || path.join(ROOT, "config/private-local"),
      );
    if (args.includes("--dry-run"))
      console.log(
        JSON.stringify({ output: directory, files, dryRun: true }, null, 2),
      );
    else {
      console.log(
        JSON.stringify(
          {
            salaryBeforeTaxYuanPerMonth:
              files["job-filters"].minimumMonthlySalaryK * 1000,
            schedule: files.agent.schedule,
            model: files.model,
          },
          null,
          2,
        ),
      );
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
