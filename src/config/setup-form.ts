import { createInterface } from "node:readline/promises";
import { planSetup } from "./setup.ts";

export async function setupForm() {
  if (!process.stdin.isTTY) throw Error("非交互安装请传 --answers 文件");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const defaults = planSetup({});
    const schedule = defaults.agent.schedule;
    const scaleMap = { "1": 20, "2": 100, "3": 500, "4": 1000, "5": 10000 };
    const defaultScale = Object.entries(scaleMap).find(
      ([, value]) => value === defaults.agent.search.minimumCompanySize,
    )?.[0];
    const ask = (prompt: string) => rl.question(prompt);
    const cities = await ask(
      "城市（逗号分隔；内置杭州、深圳、成都、南京；其他城市用答案文件提供编码）：",
    );
    const salary = await ask(
      `最低税前工资【元/月】，如6000或11000，不能填6/月（默认${defaults["job-filters"].minimumMonthlySalaryK * 1000}）：`,
    );
    const scale = await ask(
      `公司规模下限选项：1=20人，2=100人，3=500人，4=1000人，5=10000人（默认${defaultScale}）：`,
    );
    if (scale && !scaleMap[scale])
      throw Error("公司规模请选择1–5，不接受自由描述");
    const keywords = await ask("岗位关键词（逗号分隔）：");
    const directions = await ask("岗位方向（如产品或开发）：");
    const ignore = await ask(
      `忽略学历/年限要求？y/n（默认${defaults.agent.search.ignoreEducationAndExperience ? "y" : "n"}）：`,
    );
    const internship = await ask(
      `排除实习？y/n（默认${defaults["job-filters"].excludeInternships ? "y" : "n"}）：`,
    );
    for (const value of [ignore, internship])
      if (value && !["y", "n"].includes(value.toLowerCase()))
        throw Error("布尔选项请填写y或n");
    const interval = await ask(
      `运行间隔【分钟】（默认${schedule.intervalMinutes}）：`,
    );
    const daily = await ask(
      `每日新HR上限【人】，最多70（默认${schedule.dailyNewContactLimit}）：`,
    );
    const perRun = await ask(
      `正式运行每轮上限【人】，1–10（默认${schedule.productionPerRun}）；单轮验收另固定1人：`,
    );
    const resume = await ask(
      `平台附件名（可稍后通过附件列表选择，默认${defaults.agent.resumeFile}）：`,
    );
    const model = await ask("Codex模型（留空使用默认，后续检查账号权限）：");
    const effort = await ask("推理强度（留空默认）：");
    const browserBinary = await ask("Chrome/Chromium绝对路径（留空默认）：");
    const codexBinary = await ask("Codex绝对路径（留空默认）：");
    const split = (s: string) =>
      s
        .split(/[,，]/)
        .map((x) => x.trim())
        .filter(Boolean);
    return {
      ...(cities ? { cities: split(cities) } : {}),
      ...(salary ? { minimumMonthlySalaryYuan: Number(salary) } : {}),
      ...(scale ? { minimumCompanySize: scaleMap[scale] } : {}),
      ...(keywords ? { keywords: split(keywords) } : {}),
      ...(directions ? { directions } : {}),
      ...(ignore
        ? { ignoreEducationAndExperience: ignore.toLowerCase() === "y" }
        : {}),
      ...(internship
        ? { excludeInternships: internship.toLowerCase() === "y" }
        : {}),
      ...(interval ? { intervalMinutes: Number(interval) } : {}),
      ...(daily ? { dailyNewContactLimit: Number(daily) } : {}),
      ...(perRun ? { perRun: Number(perRun) } : {}),
      ...(resume ? { resumeFile: resume } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { reasoningEffort: effort } : {}),
      ...(browserBinary ? { browserBinary } : {}),
      ...(codexBinary ? { codexBinary } : {}),
    };
  } finally {
    rl.close();
  }
}
