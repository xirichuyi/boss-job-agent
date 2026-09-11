# BOSS Job Agent

基于 Codex CLI 与可视化 Chromium 的个人求职助手：搜索岗位、读取 JD、生成定制消息，并处理已有 HR 会话。

**实验性、自托管、非 BOSS 官方项目。默认不发送，不绕过扫码、人机验证和平台限制。** 平台 DOM、账号权限和网络变化仍可能需要人工处理。当前主要支持 Linux 服务器；不是跨平台一键安装包。

## 交给 Agent 安装的提示词

复制给安装 Agent：

```text
请部署 https://github.com/xirichuyi/boss-job-agent 。先读 README、SECURITY、ARCHITECTURE，并检查系统、现有服务、Node/Python、浏览器和 Codex CLI。先列变更清单，不覆盖已有代码、账本、浏览器目录或 systemd unit。

代码放在我确认的 /opt 工作目录。先运行 npm ci，再使用 npm run setup 生成独立私密配置目录；通过 BOSS_CONFIG_DIR 指向该目录，所有 CLI、后台服务、浏览器启动器保持一致。
agent.json 管理规模、关键词、频率、额度、附件名和程序路径；job-filters.json 管理城市、薪资和岗位类型；model.json 管理模型和推理强度；execution.json 管理并行和恢复策略。不要再写 agent.search.city/cityCode，不把偏好硬编码进代码或提示词。

配置向导只生成配置，不会安装软件、填写简历、初始化账本、登录或授权发送。读取我提供的真实经历到私密 candidate-profile.md，文件0600、目录0700；不要猜测履历、薪资、到岗日期。令牌只写私密文件，不输出、不提交。

运行 npm run doctor -- --offline 检查本机，再配置非root Chromium、独立用户目录及本地监听端口。通过SSH隧道或有身份认证的网关让我扫码，不关闭sandbox、不直接暴露CDP/VNC/noVNC。只对全新目录执行 npm run init。打开岗位页和聊天页，再运行 npm run doctor、npm run health、npm run status；区分检查成功与尚未验证的模型权限/附件/真实发送。

保持 enabled=false、automationReady=false。未经我明确确认，不执行 enable --confirm-real-sends、scheduler.py --once 或真实发送。授权后首次 perRun=1，以平台送达回执验收。服务模板要审核路径、用户、权限和 BOSS_CONFIG_DIR；不要强杀正在等待回执的发送。Telegram仅用于查询、验证提醒和恢复耗尽的去重告警。

交付实际配置路径、服务状态、测试结果、未验证项与恢复办法。不要把 active/completed 当成已投递，不承诺绝对无人值守。
```

## 快速开始

要复现完整常驻流程，参见 [部署与逐项验收](docs/DEPLOYMENT-ACCEPTANCE.md)。代码测试、现场检查、真实送达是三种不同的验收，不能互相替代。

前置：Linux、Node.js 24+、Python 3.11+、可用的 Codex CLI 与浏览器。systemd 仅用于服务器常驻服务。

```bash
git clone https://github.com/xirichuyi/boss-job-agent.git
cd boss-job-agent
npm ci
npm test
npm run setup
export BOSS_CONFIG_DIR="$PWD/config/private-local"
npm run doctor -- --offline
```

向导默认写入 `config/private-local`（不进 Git），拒绝覆盖已有目录，首次每轮最多联系1位新HR。可用 `--output` 选择新目录；请使用向导打印的真实路径设置环境变量。

安装 Agent 或非交互环境可以使用：

```bash
npm run setup -- --answers examples/setup-answers.json --dry-run
```

修改自己的答案文件后去掉 `--dry-run` 才会生成配置。答案示例不是本人简历。向导不会安装依赖、启动浏览器、改动已有账本或启用发送。

仅全新安装执行：

```bash
npm run init
cp examples/candidate-profile.md candidate-profile.md
chmod 600 candidate-profile.md
```

填写本人真实资料。`resumeFile` 必须与 BOSS 附件列表中的文件名一致。默认模型需要自己的账号具备权限，doctor 不会为验证权限消耗模型额度。

### 浏览器与扫码

`scripts/start-desktop.sh` 需 Xvfb、fluxbox、x11vnc、noVNC/websockify、xdpyinfo 和 Chromium；依赖需按发行版安装，doctor 不会自动安装它们。以**非 root 用户**运行，不添加 `--no-sandbox`。

默认浏览器目录 `/var/lib/boss-rpa` 必须归浏览器用户所有，或通过 `BOSS_RPA_DATA_DIR` 指定可写目录。默认 CDP/VNC/noVNC 为9222/5900/6080，读取 agent.json；图形参数由 DISPLAY_NUMBER、SCREEN_SIZE、NOVNC_WEB_ROOT、START_URL 配置。

**端口仅本地监听，通过 SSH 隧道或已验证的认证网关访问。** 不附带作者域名、Cloudflare配置或账号。人工扫码并打开岗位页、聊天页后：

```bash
npm run doctor
npm run health
npm run status
```

doctor 给出逐项结果、修复建议；`--json` 输出机器可读报告。`--offline` 不访问浏览器接口。检查不发送、不调用模型；看到标签页不等于已验证登录、模型权限或附件。

本人确认筛选、资料和发送授权后才执行：

```bash
node scripts/enable.mjs --confirm-real-sends
python3 scripts/scheduler.py --once
```

**最后一条会真实联系 HR，不是预览。** 先验收一轮送达回执，再扩大额度。

## 生效配置

推荐用 **BOSS_CONFIG_DIR 指定一个完整配置目录**。未指定时使用仓库 config/。四份文件不隐式合并，缺失即报错；状态命令显示实际配置及来源路径。

| 文件 | 唯一职责 |
| --- | --- |
| agent.json | 规模与平台规模档位、关键词、岗位方向、调度额度、工作流预算、附件名、浏览器与程序路径 |
| job-filters.json | cities（名称和平台编码）、薪资下限、实习排除、原生薪资/岗位类型档位、联系人扫描参数 |
| model.json | 模型与推理强度，不自动切换其他模型 |
| execution.json | 并行开关与联系人恢复预算 |
| candidate-profile.md | 本人资料，私密、不提交 |
| memory/ | SQLite账本、回执、日志和可选Telegram配置，私密、不提交 |

旧 `BOSS_AGENT_CONFIG`、`BOSS_JOB_FILTERS_CONFIG` 单文件覆盖仍兼容，优先于目录；doctor 会提示弃用字段。旧 agent.search.city/cityCode 与 workflow.conversationPages 不再是生效来源。不要在状态JSON里修改偏好。

默认轮换杭州、深圳、成都、南京，产品/开发方向，500人以上、月薪区间下限至少11K、非实习。城市会通过原生热门/字母分组选项定位，核对API响应城市码；未知编码需人工验证，不猜测。

BOSS 薪资是单选档位：405/406/407对应10–20K、20–50K、50K以上。轮换全部城市、关键词、薪资档位后，本地代码再核对精确月薪下限，不由AI猜测。公司规模代码304/305/306对应500–999、1000–9999、10000人以上。

修改偏好后用 `npm run status` 查看实际生效值，再人工核对平台筛选。常驻进程需重启加载进程级配置；不要强杀在途发送。多个城市共用每日额度，按 Asia/Shanghai 自然日结算，最多70位新HR。

## 运行架构

Python只负责分钟唤醒、OS文件锁和进程组超时；业务、浏览器、模型与SQLite状态均在JavaScript中。不维护两套业务逻辑。

```text
scheduler.py（进程监督，15分钟硬超时）
  → scheduled-agent.mjs（授权、队列、租约、额度）
    → run-cycle.mjs（生命周期、持久化、最终收尾）
      → workflows/cycle-runner.js
          ├─ 搜索 → JD → 批量文案 → 联系
          └─ 对账/恢复 → 收件箱 → 回复/附件
              共用聊天互斥队列；模型在后台线程中等待
```

搜索与收件箱并行，排队的回复优先，但不打断已开始的发送。正文由AI生成，不做第二轮AI审稿；岗位身份、非空消息、授权、防重、回执由程序核对。模型冷却只延后生成，不停止平台读取和无需新生成的恢复任务。

`completed` 不等于发过消息，须查看 result、receipts 和各阶段统计。没有平台幂等键，不能承诺 exactly-once。

## 常驻运行、暂停与升级

审核 deploy/ 中模板并替换 @ROOT@、@USER@、@NODE@、@PYTHON@。代码路径、执行用户、私密目录与Codex账号必须对应。每个使用配置的unit都应设置同一个 `Environment="BOSS_CONFIG_DIR=/绝对路径"`。不要覆盖已有同名服务。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now job-agent-scheduler.service
npm run status
node scripts/agent-control.mjs pause
node scripts/agent-control.mjs resume
```

pause/maintenance 禁止新发送但不直接停止服务，让在途回执完成；服务 active 不等于任务已启用。maintenance 接收分钟数，如 `maintenance 15`。resume 默认尝试启动systemd服务，需对应管理权限；前台运行可用 `resume --state-only`，然后手动运行调度器。不得因此授予任意sudo权限。

升级前暂停并等当前周期结束，备份完整SQLite及私密配置，记录当前Git提交。不要直接覆盖代码和正在写入的数据库；参见 [架构与审查记录](ARCHITECTURE.md)。尚无自动升级/回滚器，也尚未完成多操作系统安装验证。

## 故障恢复和Telegram

收件箱按联系人隔离错误，读取失败按 execution.json.inboxRetry 退避（默认30分钟起、最多240分钟）。暂停、登录验证和关键存储故障仍停止后续发送；已执行但结果不明的消息只对账，不盲重发。watchdog.business 单独记录业务健康，连续失败阈值由 execution.json.businessHealth 配置；不因零发送或业务告警强杀服务，也不逐步推送Telegram。

会话暂未就绪/查找失败且预算足够时，最多立即重读一次，仍执行身份核对，不刷新或重发。readRetryMinRemainingMs 默认60000。回复生成后先保存草稿；本轮超时则下轮优先处理，只有重新读取的平台历史、个人资料和提示词指纹一致才复用，否则废弃重判。人工已回复则取消草稿；HR分多条索要简历和追问时，附件请求不再被后一句覆盖。联系人记录保留 lastReplyDecision，便于区分“读取失败”“等待事实补充”“正常无需回复”。

成熟框架的复用取舍和迁移风险见 [开源复用审查](docs/REUSE-REVIEW.md)。这些是候选，不代表已安装或完成集成。

发送前保存意图；发送结果不明时隔离联系人、保留额度，不盲重发。列表找不到HR时先用平台搜索匹配公司与姓名，再核对会话岗位。

execution.json.contactRecovery 默认每轮最多3人、2分钟，失败间隔30分钟、累计最多3次。只有证明定制话术尚未进入发送、且当前仅有默认招呼时才补发；HR已回复则交给收件箱。记录阶段、原因、次数和下次时间，耗尽后提示人工处理，其他任务继续。

Telegram可选：令牌存 memory/telegram-secrets.json，私聊绑定存 memory/telegram-config.json，权限0600。令牌结构为 {"token":"自己的令牌"}。填写本人核实的chatId，或配置pairCode、pairIssuedAt、pairExpiresAt后使用私聊配对；不猜测ID，不从群聊绑定。

/status 不调用模型；自然语言查询使用配置模型；/run 只入队，不越过暂停、验证或额度。只主动推送验证码和恢复耗尽的去重提醒，不逐步播报；断网时无法立即通知。

## 已知边界

- 平台DOM变化、登录验证、限额仍会使部分操作暂停；测试通过不等于真实平台始终可用。
- 陌生/人工联系但未核实JD的会话只记录待核实，不自动冒险回复；尚无可视化接管向导。
- 扫描和翻页受预算限制，不代表遍历了所有岗位或未读消息。
- 附件发送有实现和mock测试，但缺少广泛真实场景覆盖。
- 模型输出不能保证永远准确；不编造履历，不擅自承诺面试时间或薪资。
- 配置向导不是系统软件安装器；systemd权限、浏览器认证网关仍需部署者核对。
- 当前仍保留Python监督层，未为统一语言重写可靠的进程组超时机制。

## 开源与隐私

MIT。简历、聊天、日志、令牌和浏览器目录不进Git。公开issue前必须脱敏，详见 [SECURITY.md](SECURITY.md)、[CONTRIBUTING.md](CONTRIBUTING.md)。

[Linux DO 社区](https://linux.do/)
