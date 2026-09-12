import fs from "node:fs";
import path from "node:path";
import { configFile } from "./files.ts";
import { resolveExecutable } from "./executable.ts";

export function planSetup(answers) {
  const keys = [
    "cities",
    "minimumMonthlySalaryK",
    "minimumCompanySize",
    "keywords",
    "resumeFile",
    "model",
    "reasoningEffort",
    "browserBinary",
    "codexBinary",
    "minimumMonthlySalaryYuan",
    "intervalMinutes",
    "dailyNewContactLimit",
    "perRun",
    "directions",
    "ignoreEducationAndExperience",
    "excludeInternships",
  ];
  if (
    !answers ||
    Array.isArray(answers) ||
    typeof answers !== "object" ||
    Object.keys(answers).some((k) => !keys.includes(k))
  )
    throw Error(
      "答案文件包含未知字段或格式错误；参见 examples/setup-answers.json",
    );
  const files = Object.fromEntries(
    ["agent", "job-filters", "model", "execution"].map((n) => [
      n,
      JSON.parse(fs.readFileSync(configFile(n, {}), "utf8")),
    ]),
  );
  const catalog = files["job-filters"].cities;
  const choices = answers.cities || catalog.map((c) => c.name);
  const cities = Array.isArray(choices)
    ? choices.map((city) =>
        typeof city === "string" ? catalog.find((c) => c.name === city) : city,
      )
    : [];
  if (
    !cities.length ||
    cities.some(
      (city) =>
        !city ||
        typeof city !== "object" ||
        Object.keys(city).some((key) => !["name", "code"].includes(key)) ||
        typeof city.name !== "string" ||
        !city.name.trim() ||
        typeof city.code !== "string" ||
        !/^\d{9}$/.test(city.code),
    ) ||
    new Set(cities.map((c) => c.name)).size !== cities.length ||
    new Set(cities.map((c) => c.code)).size !== cities.length
  )
    throw Error(
      "城市需填写已知名称，或 {name, code}；编码为平台9位城市码，不可重复",
    );
  if (
    answers.minimumMonthlySalaryYuan !== undefined &&
    answers.minimumMonthlySalaryK !== undefined
  )
    throw Error("薪资只能填写一个单位字段");
  if (
    answers.minimumMonthlySalaryYuan !== undefined &&
    (!Number.isInteger(answers.minimumMonthlySalaryYuan) ||
      answers.minimumMonthlySalaryYuan < 1000)
  )
    throw Error("薪资请填税前元/月整数，如6000；不要填6/月或6K");
  const min =
    answers.minimumMonthlySalaryYuan !== undefined
      ? answers.minimumMonthlySalaryYuan / 1000
      : (answers.minimumMonthlySalaryK ??
        files["job-filters"].minimumMonthlySalaryK);
  if (!Number.isFinite(min) || min < 0)
    throw Error("月薪下限必须是非负数字，单位K");
  const size =
    answers.minimumCompanySize ?? files.agent.search.minimumCompanySize;
  const codes = {
    20: [302, 303, 304, 305, 306],
    100: [303, 304, 305, 306],
    500: [304, 305, 306],
    1000: [305, 306],
    10000: [306],
  };
  if (!codes[size]) throw Error("公司规模下限支持20、100、500、1000、10000");
  const words = answers.keywords || files.agent.search.keywords;
  if (
    !Array.isArray(words) ||
    !words.length ||
    words.some((w) => typeof w !== "string" || !w.trim() || w.length > 40)
  )
    throw Error("岗位关键词无效");
  const resume = answers.resumeFile || files.agent.resumeFile;
  if (typeof resume !== "string" || /[\/\\\r\n]/.test(resume))
    throw Error("附件名只能填写平台文件名，不能填写路径");
  const model = answers.model || files.model.model,
    effort = answers.reasoningEffort || files.model.reasoningEffort;
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model) ||
    !["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
      effort,
    )
  )
    throw Error("模型或推理强度无效");
  files["job-filters"].cities = cities;
  files["job-filters"].minimumMonthlySalaryK = min;
  // Include all bands intersecting the lower-bound requirement, then verify exact salary locally.
  files["job-filters"].nativeSalaryCodes = [
    { code: 402, max: 3 },
    { code: 403, max: 5 },
    { code: 404, max: 10 },
    { code: 405, max: 20 },
    { code: 406, max: 50 },
    { code: 407, max: Infinity },
  ]
    .filter((b) => b.max >= min)
    .map((b) => b.code);
  files.agent.search.minimumCompanySize = size;
  files.agent.search.nativeScaleCodes = codes[size];
  files.agent.search.keywords = words;
  files.agent.resumeFile = resume;
  const productionPerRun = answers.perRun ?? files.agent.schedule.perRun;
  files.agent.schedule.perRun = 1;
  for (const [key, max] of [
    ["intervalMinutes", 1440],
    ["dailyNewContactLimit", 70],
    ["perRun", 10],
  ] as const) {
    const value =
      key === "perRun"
        ? productionPerRun
        : (answers[key] ?? files.agent.schedule[key]);
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw Error(key + " 超出范围1–" + max);
    if (key === "perRun")
      files.agent.schedule.productionPerRun = productionPerRun;
    else files.agent.schedule[key] = value;
  }
  if (answers.directions !== undefined) {
    if (typeof answers.directions !== "string" || !answers.directions.trim())
      throw Error("岗位方向不能为空");
    files.agent.search.directions = answers.directions.trim();
  }
  for (const key of ["ignoreEducationAndExperience", "excludeInternships"]) {
    if (answers[key] === undefined) continue;
    if (typeof answers[key] !== "boolean") throw Error(key + " 必须是布尔值");
    (key === "excludeInternships" ? files["job-filters"] : files.agent.search)[
      key
    ] = answers[key];
  }
  for (const [answer, section] of [
    ["browserBinary", "browser"],
    ["codexBinary", "codex"],
  ]) {
    if (answers[answer] === undefined) continue;
    if (
      typeof answers[answer] !== "string" ||
      !path.isAbsolute(answers[answer]) ||
      /[\r\n]/.test(answers[answer])
    )
      throw Error(answer + " 必须是可执行文件的绝对路径");
    files.agent[section].binary = answers[answer];
  }
  files.model = { model, reasoningEffort: effort };
  files.agent.browser.binary = resolveExecutable(files.agent.browser.binary);
  files.agent.codex.binary = resolveExecutable(files.agent.codex.binary);
  return files;
}
export function writeSetup(directory, files) {
  if (fs.existsSync(directory))
    throw Error("目标目录已存在，拒绝覆盖：" + directory);
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  fs.mkdirSync(directory, { mode: 0o700 });
  for (const [name, value] of Object.entries(files))
    fs.writeFileSync(
      path.join(directory, name + ".json"),
      JSON.stringify(value, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
}
