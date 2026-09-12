import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CODE_ROOT } from "../project-root.ts";
import { planSetup } from "../config/setup.ts";
import { importProfile, validateProfile } from "../config/profile-import.ts";
import { desktopConfig } from "../config/desktop.ts";
import { resolveExecutable } from "../config/executable.ts";
import {
  configOf,
  databaseValue,
  evidence,
  fingerprint,
  initialDesktop,
  installationLock,
  requireIdle,
  runtimeEnv,
  verified,
  workspace,
  writePrivate,
} from "./workspace.ts";
import { writeServices } from "./services.ts";
import { checkDesktop } from "./browser-check.ts";

function child(state, script: string, args: string[] = [], timeout = 30000) {
  const result = spawnSync(
    process.execPath,
    [path.join(CODE_ROOT, "scripts", script), ...args],
    {
      env: runtimeEnv(state),
      encoding: "utf8",
      timeout,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  if (result.status !== 0)
    throw Error(`${script} 执行失败；保持当前状态，请运行 doctor/status 排查`);
  return result.stdout;
}
function executable(binary: string, args = ["--version"]) {
  return (
    spawnSync(binary, args, {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 65536,
    }).status === 0
  );
}
function summary(files) {
  return {
    cities: files["job-filters"].cities,
    salaryBeforeTaxYuanPerMonth:
      files["job-filters"].minimumMonthlySalaryK * 1000,
    minimumCompanySize: files.agent.search.minimumCompanySize,
    directions: files.agent.search.directions,
    ignoreEducationAndExperience:
      files.agent.search.ignoreEducationAndExperience,
    excludeInternships: files["job-filters"].excludeInternships,
    model: files.model,
    acceptancePerRun: 1,
    productionPerRun: files.agent.schedule.productionPerRun,
    intervalMinutes: files.agent.schedule.intervalMinutes,
    dailyNewContactLimit: files.agent.schedule.dailyNewContactLimit,
  };
}
async function browser(state, task) {
  Object.assign(process.env, runtimeEnv(state));
  // Browser modules load only after this workspace's configuration is selected.
  const { VisibleTools } = await import("../adapters/browser/visible.ts");
  const b = new VisibleTools();
  try {
    await b.connectView("chat");
    await b.guard();
    return await task(b);
  } finally {
    b.disconnect();
  }
}
async function attachmentNames(state) {
  return browser(state, async (b) => {
    const names = await b.evaluate(
      `([...document.querySelectorAll('.resume-name')].filter(e=>e.checkVisibility({visibilityProperty:true})).map(e=>e.textContent.trim()).filter(Boolean))`,
    );
    if (!names.length)
      throw Error(
        "请在浏览器中手动打开附件简历选择窗口，再执行 attachments；此操作不会点击发送",
      );
    return names;
  });
}
export function installationStatus(state) {
  let files;
  try {
    files = configOf(state);
  } catch {}
  let profile = false;
  try {
    validateProfile(
      fs.readFileSync(path.join(state.data, "candidate-profile.md"), "utf8"),
    );
    profile = true;
  } catch {}
  let schedule: any = {},
    cycle: any = {},
    storageError = null;
  try {
    schedule = databaseValue(state, "schedule.json", {});
    cycle = databaseValue(state, "scheduled-cycle.json", {});
  } catch {
    storageError = "账本无法读取；保留文件并修复，不重新初始化";
  }
  const initialized = typeof schedule.enabled === "boolean";
  const codex = files?.agent.codex.binary || resolveExecutable("codex");
  const dependencies = {
    node: Number(process.versions.node.split(".")[0]) >= 24,
    flock: executable("flock"),
    codexCLI: !!codex && executable(codex),
    browser: executable(
      JSON.parse(fs.readFileSync(state.desktop, "utf8")).binary,
    ),
  };
  const present = (name: string) => path.isAbsolute(resolveExecutable(name));
  const desktopDependencies = Object.fromEntries(
    ["Xvfb", "fluxbox", "x11vnc", "websockify", "xdpyinfo"].map((name) => [
      name,
      present(name),
    ]),
  );
  desktopDependencies.noVNC = fs.existsSync(
    path.join(process.env.NOVNC_WEB_ROOT || "/usr/share/novnc", "vnc.html"),
  );
  const optionalResumeConverters = Object.fromEntries(
    ["pdftotext", "pandoc", "antiword"].map((name) => [name, present(name)]),
  );
  const login =
    !!codex && dependencies.codexCLI && executable(codex, ["login", "status"]);
  const services = spawnSync(
    "systemctl",
    [
      "show",
      "job-agent-scheduler.service",
      "--property=User,Environment,ActiveState,WorkingDirectory",
    ],
    { encoding: "utf8", timeout: 5000 },
  );
  const unit = services.stdout || "";
  const serviceMatches =
    unit.includes(`User=${state.user}\n`) &&
    unit.includes(`WorkingDirectory=${CODE_ROOT.replace(/\/$/, "")}\n`) &&
    unit.includes(`BOSS_CONFIG_DIR=${state.config}`) &&
    unit.includes(`BOSS_DATA_DIR=${state.data}`);
  const checks = [
    {
      step: "运行用户",
      done: state.uid !== 0,
      next: "请以最终非 root 服务用户创建工作区；不默认复制 root 凭据",
    },
    {
      step: "基础依赖",
      done: Object.values(dependencies).every(Boolean),
      next: "安装缺失依赖，核对 desktop.json/browser 路径",
    },
    {
      step: "远程桌面依赖",
      done: Object.values(desktopDependencies).every(Boolean),
      next: "使用内置远程桌面需补齐桌面依赖；已有外部桌面可自行管理浏览器",
    },
    {
      step: "浏览器桌面配置",
      done: fs.existsSync(state.desktop),
      next: "desktop → services 或 browser-start，可先扫码后配置求职",
    },
    {
      step: "求职配置",
      done: !!files,
      next: "configure --answers 本人答案.json；预览后加 --confirm",
    },
    {
      step: "简历正文",
      done: profile,
      next: "profile --file 本人简历.pdf（也支持DOCX/DOC/MD/TXT）或 --paste；预览后 --confirm",
    },
    {
      step: "初始化",
      done: initialized,
      next: storageError || "initialize；再次执行不会清空账本",
    },
    {
      step: "运行用户Codex登录",
      done: login,
      next: "login；如需复用登录缓存，先本人授权并按官方文档迁移，安装器不复制",
    },
    {
      step: "模型实际调用",
      done: verified(state, "model"),
      next: "model-check --confirm-model-call（会消耗少量额度）",
    },
    {
      step: "BOSS登录",
      done: verified(state, "browser"),
      next: "人工扫码后 browser-check；页面可达不等于登录",
    },
    {
      step: "附件文件名",
      done: verified(state, "attachment"),
      next: "打开附件列表 → attachments → attachment --name 精确文件名 --confirm",
    },
    {
      step: "真实定制消息验收",
      done: verified(state, "acceptance") || verified(state, "production"),
      next: "accept --confirm-real-sends；必须收到定制正文送达回执",
    },
    {
      step: "正式参数确认",
      done: verified(state, "production"),
      next: "activate 预览正式人数/间隔/上限，再加 --confirm-real-sends",
    },
    {
      step: "常驻服务",
      done: serviceMatches && unit.includes("ActiveState=active"),
      next: "services 生成模板，管理员审核安装；无须给运行用户sudo权限",
    },
  ];
  return {
    user: state.user,
    dependencies,
    desktopDependencies,
    optionalResumeConverters,
    mode: schedule.enabled
      ? verified(state, "production")
        ? "正式运行已授权"
        : "发送已授权但尚未正式交付"
      : initialized
        ? "已初始化，未运行"
        : "安装未完成",
    checks,
    next: checks.find((c) => !c.done)?.next || "检查业务送达统计",
    parameters: files ? summary(files) : null,
    attachmentDelivery:
      cycle?.result?.attachmentsSent > 0
        ? "最近一轮有附件回执"
        : "尚无本次真实附件送达验收",
    serviceMatches,
    storageError,
    lastError: state.lastError || null,
    currentAction: state.currentAction || null,
  };
}

export async function installAction(
  action: string,
  directory: string,
  options: Record<string, any> = {},
) {
  const { state, save } = workspace(directory, action === "init");
  initialDesktop(state);
  if (state.codexHome) process.env.CODEX_HOME = state.codexHome;
  else delete process.env.CODEX_HOME;
  if (["status", "continue", "init"].includes(action))
    return installationStatus(state);
  // Foreground daemons must not hold the installer lock: pause/status remain usable.
  const tracked = !["start", "browser-start"].includes(action);
  const unlock = tracked ? installationLock(state) : () => {};
  state.currentAction = { action, since: new Date().toISOString() };
  delete state.lastError;
  if (tracked) save();
  const confirm = () => {
    if (!options.confirm) throw Error("先预览并核对，再加 --confirm");
  };
  try {
    if (action === "init" || action === "status" || action === "continue")
      return installationStatus(state);
    if (action === "desktop")
      return {
        config: state.desktop,
        data: state.browserData,
        value: desktopConfig(runtimeEnv(state)),
        next: "可先 browser-start 或安装桌面服务，再扫码；无需先填写简历",
      };
    if (action === "browser-start") {
      if (state.uid === 0) throw Error("请以非 root 用户启动浏览器");
      const result = spawnSync(
        "bash",
        [path.join(CODE_ROOT, "scripts/start-desktop.sh")],
        { env: runtimeEnv(state), stdio: "inherit" },
      );
      if (result.status !== 0)
        throw Error("浏览器桌面退出；查看工作区 browser/logs");
      return { stopped: true };
    }
    if (action === "access") {
      const d = desktopConfig(runtimeEnv(state));
      const target = options.ssh;
      if (
        typeof target !== "string" ||
        !/^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+$/.test(target)
      )
        throw Error("--ssh 请填 用户@服务器域名或IP");
      return {
        commandOnLocalComputer: `ssh -N -L 127.0.0.1:${d.webPort}:127.0.0.1:${d.webPort} ${target}`,
        browserURL: `http://127.0.0.1:${d.webPort}/vnc.html?autoconnect=1&resize=scale`,
        boundary: "仅经SSH认证访问；未配置公网DNS/HTTPS，不暴露CDP/VNC",
      };
    }
    if (action === "configure") {
      requireIdle(state);
      const draft = path.join(state.root, "configuration-draft.json");
      const supplied =
        options.answersObject ??
        JSON.parse(fs.readFileSync(options.answers || draft, "utf8"));
      const binding = path.join(state.root, "bootstrap-paths.json");
      const answers = fs.existsSync(binding)
        ? { ...JSON.parse(fs.readFileSync(binding, "utf8")), ...supplied }
        : supplied;
      const files = planSetup(answers);
      if (!options.confirm) {
        writePrivate(draft, answers);
        return {
          preview: summary(files),
          next: "核对税前元/月及正式每轮人数后，加 --confirm 保存",
        };
      }
      if (answers.browserBinary)
        writePrivate(state.desktop, {
          ...desktopConfig(runtimeEnv(state)),
          binary: answers.browserBinary,
        });
      // Preserve independent desktop identity when business configuration is created.
      files.agent.browser = {
        ...files.agent.browser,
        ...desktopConfig(runtimeEnv(state)),
      };
      if (fs.existsSync(state.config))
        for (const name of ["agent", "model", "execution", "job-filters"])
          if (fs.existsSync(path.join(state.config, name + ".json")))
            writePrivate(
              path.join(
                state.root,
                "config-backups",
                Date.now() + "-" + name + ".json",
              ),
              fs.readFileSync(path.join(state.config, name + ".json"), "utf8"),
            );
      for (const [name, value] of Object.entries(files))
        writePrivate(path.join(state.config, name + ".json"), value);
      return { saved: true, preview: summary(files) };
    }
    if (action === "profile") {
      requireIdle(state);
      const text =
        options.text !== undefined
          ? validateProfile(options.text)
          : options.file
            ? importProfile(options.file)
            : validateProfile(
                fs.readFileSync(
                  path.join(state.root, "profile-draft.md"),
                  "utf8",
                ),
              );
      if (!options.confirm) {
        writePrivate(path.join(state.root, "profile-draft.md"), text);
        return {
          preview: text,
          next: "核对转换后的本人经历，再加 --confirm；扫描PDF需先OCR",
        };
      }
      const file = path.join(state.data, "candidate-profile.md");
      if (fs.existsSync(file))
        writePrivate(
          path.join(state.root, "profile-backups", Date.now() + ".md"),
          fs.readFileSync(file, "utf8"),
        );
      writePrivate(file, text);
      return { saved: true, characters: text.length };
    }
    if (action === "initialize") {
      configOf(state);
      validateProfile(
        fs.readFileSync(path.join(state.data, "candidate-profile.md"), "utf8"),
      );
      if (!fs.existsSync(path.join(state.data, "memory/harness.sqlite")))
        child(state, "init.ts");
      if (
        typeof databaseValue(state, "schedule.json", {}).enabled !== "boolean"
      )
        throw Error("账本未完整初始化；保留现场，请检查，不覆盖数据库");
      return {
        initialized: true,
        enabled: databaseValue(state, "schedule.json", {}).enabled || false,
      };
    }
    if (action === "services")
      return {
        directory: writeServices(state),
        next: "管理员核对用户、路径和已有同名服务后安装；先启动desktop，真实验收完成后再启动scheduler。运行用户无须sudo。",
      };
    if (action === "pause" || action === "resume") {
      if (action === "resume" && !verified(state, "production"))
        throw Error("先完成单轮验收并确认正式参数 activate");
      child(state, "agent-control.ts", [action, "--state-only"]);
      return {
        authorization: action,
        next: "只更新运行授权，不调用systemctl；服务未启动时由管理员启动，或使用 start 前台运行",
      };
    }
    if (action === "start") {
      if (!verified(state, "production"))
        throw Error("先完成正式参数确认 activate");
      const r = spawnSync(
        process.execPath,
        [path.join(CODE_ROOT, "scripts/scheduler.ts")],
        { env: runtimeEnv(state), stdio: "inherit" },
      );
      if (r.status !== 0) throw Error("调度器异常退出");
      return { stopped: true };
    }
    if (action === "browser-check") {
      const result = await checkDesktop(state);
      evidence(state, "browser", result);
      return result;
    }
    const files = configOf(state);
    if (action === "login") {
      if (executable(files.agent.codex.binary, ["login", "status"]))
        return {
          loggedIn: true,
          user: state.user,
          modelCallable: verified(state, "model"),
        };
      const r = spawnSync(
        files.agent.codex.binary,
        ["login", "--device-auth"],
        { stdio: "inherit" },
      );
      if (r.status !== 0)
        throw Error(
          "登录未完成，请以同一个服务用户重试；不自动复制其他用户凭据",
        );
      return { loggedIn: true, user: state.user, modelCallable: false };
    }
    if (action === "model-check") {
      if (!options["confirm-model-call"])
        throw Error(
          "此检查会调用所选模型并消耗额度，请加 --confirm-model-call",
        );
      if (
        state.uid === 0 ||
        !executable(files.agent.codex.binary, ["login", "status"])
      )
        throw Error("必须以已登录的非 root 服务用户检查模型");
      const tmp = fs.mkdtempSync(path.join(state.root, "model-check-"));
      const r = spawnSync(
        files.agent.codex.binary,
        [
          "exec",
          "--ephemeral",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--json",
          "-m",
          files.model.model,
          "-c",
          `model_reasoning_effort=${JSON.stringify(files.model.reasoningEffort)}`,
          "Reply exactly OK. Do not use tools or read files.",
        ],
        {
          cwd: tmp,
          encoding: "utf8",
          timeout: files.agent.codex.timeoutMs,
          maxBuffer: 1024 * 1024,
        },
      );
      const events = (r.stdout || "").split("\n").flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
      if (
        r.status !== 0 ||
        !events.some((e) => e.type === "turn.completed") ||
        !events.some(
          (e) =>
            e.item?.type === "agent_message" && e.item.text.trim() === "OK",
        )
      )
        throw Error(
          "所选模型调用未通过；核对模型权限/额度/网络，不自动切换模型",
        );
      evidence(state, "model", { model: files.model.model, user: state.user });
      return {
        modelCallable: true,
        model: files.model.model,
        user: state.user,
      };
    }
    if (action === "attachments")
      return {
        filenames: await attachmentNames(state),
        next: "attachment --name 精确文件名 --confirm；不会发送附件",
      };
    if (action === "attachment") {
      requireIdle(state);
      confirm();
      const names = await attachmentNames(state);
      if (names.filter((n) => n === options.name).length !== 1)
        throw Error("附件文件名不存在或不唯一，请重新读取列表");
      files.agent.resumeFile = options.name;
      writePrivate(path.join(state.config, "agent.json"), files.agent);
      evidence(state, "attachment", { filename: options.name });
      return {
        filenameMatched: true,
        filename: options.name,
        deliveryVerified: false,
      };
    }
    if (action === "accept") {
      requireIdle(state);
      if (!options["confirm-real-sends"])
        throw Error("真实单轮验收会联系HR，请明确授权 --confirm-real-sends");
      for (const name of ["model", "browser", "attachment"])
        if (!verified(state, name)) throw Error(name + " 尚未核验或配置已改变");
      if (files.agent.schedule.perRun !== 1)
        throw Error("单轮验收每轮必须为1，请重新 configure");
      if (
        executable("systemctl", [
          "is-active",
          "--quiet",
          "job-agent-scheduler.service",
        ])
      )
        throw Error("先由管理员停止常驻调度服务，避免单轮授权被常驻服务抢占");
      await browser(state, async () => {});
      const before = databaseValue(state, "scheduled-cycle.json", {}).id;
      try {
        child(state, "enable.ts", ["--confirm-real-sends"]);
        child(
          state,
          "scheduler.ts",
          ["--once"],
          files.execution.supervisor.workerTimeoutMs + 120000,
        );
      } finally {
        child(state, "agent-control.ts", ["pause", "--state-only"]);
      }
      const cycle = databaseValue(state, "scheduled-cycle.json", {}),
        report = databaseValue(state, `cycles/${cycle.id}.json`, {});
      if (
        !cycle.id ||
        cycle.id === before ||
        !report.intents?.some(
          (i) => i.kind === "targeted_message" && i.status === "delivered",
        )
      )
        throw Error(
          "尚无本轮定制正文送达回执；保持暂停，不把默认招呼算验收通过",
        );
      evidence(state, "acceptance", { cycle: cycle.id, result: report.result });
      return {
        accepted: true,
        paused: true,
        result: report.result,
        next: "activate 预览并确认正式运行参数",
      };
    }
    if (action === "activate") {
      const plan = summary(files);
      if (!options["confirm-real-sends"])
        return {
          preview: plan,
          next: "核对正式每轮/间隔/每日额度，加 --confirm-real-sends；不会自动获得systemctl权限",
        };
      const transition = state.productionTransition;
      const continuing =
        transition?.target === fingerprint(state) &&
        transition?.source === state.checks.acceptance?.fingerprint &&
        state.checks.acceptance?.uid === state.uid;
      if (state.uid === 0 || (!verified(state, "acceptance") && !continuing))
        throw Error("须由同一个非 root 用户完成当前配置的真实验收");
      const count = files.agent.schedule.productionPerRun;
      if (!Number.isInteger(count) || count < 1 || count > 10)
        throw Error("正式每轮人数无效");
      if (!(continuing && databaseValue(state, "schedule.json", {}).enabled)) {
        requireIdle(state);
        const source = continuing ? transition.source : fingerprint(state);
        files.agent.schedule.perRun = count;
        state.productionTransition = {
          source,
          target: fingerprint(state, files.agent),
          approvedAt: new Date().toISOString(),
        };
        save(); // Preserve the authorized promotion before config/ledger writes.
        writePrivate(path.join(state.config, "agent.json"), files.agent);
        child(state, "enable.ts", ["--confirm-real-sends"]);
      }
      evidence(state, "production", { ...plan, perRun: count });
      delete state.productionTransition;
      return {
        authorized: true,
        perRun: count,
        intervalMinutes: plan.intervalMinutes,
        dailyNewContactLimit: plan.dailyNewContactLimit,
        next: "start 前台运行，或由管理员启动已核对的常驻服务",
      };
    }
    throw Error("未知安装操作");
  } catch (error) {
    state.lastError = {
      action,
      reason: error.message,
      at: new Date().toISOString(),
    };
    throw error;
  } finally {
    delete state.currentAction;
    try {
      if (tracked) save();
    } finally {
      unlock();
    }
  }
}
