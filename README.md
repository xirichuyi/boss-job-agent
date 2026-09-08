# BOSS Job Agent

基于 Codex CLI 和可视化 Chromium 的个人求职助手：读取岗位 JD 与个人资料，生成针对岗位的消息，通过 BOSS 原生页面联系 HR，并集中处理已有聊天。

**实验性、自托管项目。默认不发送，不绕过扫码、人机验证或平台限制。不是 BOSS 官方项目，不保证持续可用、每天联系满额或获得面试。** 使用前确认平台规则与账号授权；只对相关岗位进行合理、个性化沟通，不用于群发骚扰。

## 工作方式

```text
Python 定时器 / 手动请求 / Telegram /run
    → SQLite 请求队列、执行租约、额度预留
    → 搜索岗位 → 读取 JD → Codex 批量决策
    → 逐个核对公司和聊天 → 原生页面发送 → 保存送达回执
    → 轮询已有聊天 → 回复 / 按请求发送指定附件
```

模型只生成结构化决策，不直接操作浏览器。最多三份 JD 合并为一次模型调用，正文逐个发送；不做第二次 AI 审稿，也不使用关键词、第一人称或文案字数的代码拦截。岗位 ID 对应、消息非空、动作结构、运行授权、同公司去重和回执确认仍由程序执行。

平台当前聊天包含人工发送的信息。`completed` 不等于已投递，必须看 `result` 和 `receipts`。发送结果不明时隔离联系人，不自动重复点击；没有平台幂等键，不能承诺 exactly-once。

## 配置：修改配置，不改代码

| 文件 | 用途 |
| --- | --- |
| `config/model.json` | Codex 模型、推理强度；默认 `gpt-5.6-luna` / `high`，需要账号有调用权限 |
| `config/agent.json` | 城市及平台城市编码、人数下限及原生规模档位、关键词、岗位方向、学历年限策略、调度额度、工作流预算、附件名、CDP/网页地址、Codex 路径与超时 |
| `candidate-profile.md` | 本人的真实经历，私密、不入库到 Git |
| `memory/telegram-secrets.json` | 可选 Telegram token，私密、不进 Git |
| `memory/telegram-config.json` | 可选私聊绑定配置，私密、不进 Git |
| `memory/harness.sqlite` | 运行状态、队列、额度、账本；不是用户偏好的第二份配置 |

配置每个进程启动时加载并校验。调度器每轮启动新进程，自然读取新配置；Telegram 常驻进程需要重启。不要为改配置强杀正在等待发送回执的任务。JSON 状态文件仅为兼容导出，不要直接修改它们控制运行。

需要私密配置时，将完整 agent.json 保存到 `config/private-agent.json`，以环境变量 `BOSS_AGENT_CONFIG` 指向它（已忽略 Git）；不合并多层默认值。配置可以从任意部署路径加载，代码不固定作者的服务器目录。

城市名与 cityCode 应对应；公司人数和 nativeScaleCodes 应对应平台选项。默认 `[304,305,306]` 对应 500–999、1000–9999、10000 人以上。页面适配器目前只会从原生热门城市列表选择城市；没有对应选项时停止，不会猜测或继续发错城市。更改条件后先人工核对原生筛选是否生效。

每天最多 70 位新 HR、每次模型批量最多 3 个岗位、单轮进程组最多 15 分钟是当前安全/协议边界。业务参数只能在校验范围内调整。时间配额按 `Asia/Shanghai` 自然日结算，尚不支持跨时区配额迁移。

## 安装与首次验证

需要 Linux/systemd、Node.js 24、Python 3.11+、已安装并登录的 Codex CLI，以及可访问的有界面 Chromium。浏览器需 Xvfb、fluxbox、x11vnc、noVNC/websockify、xdpyinfo 等；不同发行版包名可能不同，安装前核对。Codex CLI 参数和模型权限可能随版本/账号变化，本项目不替你获取账号或凭据。

```bash
git clone https://github.com/xirichuyi/boss-job-agent.git
cd boss-job-agent
npm ci
npm test
python3 -m unittest discover -s test -p '*_test.py'
npm run init
cp examples/candidate-profile.md candidate-profile.md
chmod 600 candidate-profile.md
```

初始化不联网、不调用模型、不发送，不覆盖已有数据库。填写真实资料，并修改两个配置文件；`resumeFile` 必须与 BOSS 账号附件列表中的实际文件名完全一致。模型使用自己的 Codex 登录，订阅额度不等于 API 标价，high 可能增加推理 token 消耗。

浏览器辅助脚本为 `scripts/start-desktop.sh`：以**非 root 用户**运行 Chromium，不添加 `--no-sandbox`。默认数据目录 `/var/lib/boss-rpa` 需先交给浏览器用户所有，或通过 `BOSS_RPA_DATA_DIR` 指定其可写目录。图形参数可用 `DISPLAY_NUMBER`、`SCREEN_SIZE`、`NOVNC_WEB_ROOT`、`START_URL` 环境配置。程序路径与三个端口均读取 `config/agent.json` 的 browser 配置，默认 CDP 9222、VNC 5900、noVNC 6080；端口冲突会报错。CDP 只接受本机地址，远程浏览器通过 SSH 隧道连接。

**仅本地监听，禁止直接暴露这些端口。** 通过 SSH 隧道访问 noVNC，或自己部署并验证 Cloudflare Access 等认证网关。项目不附带作者的域名、隧道、Google 登录配置或任何账号。人工扫码登录后打开岗位搜索页与聊天页，执行只读检查：

```bash
node scripts/browser-health.mjs
node scripts/agent-status.mjs
```

只有本人确认筛选、资料、附件和真实发送授权后，才执行：

```bash
node scripts/enable.mjs --confirm-real-sends
python3 scripts/scheduler.py --once
```

**最后一条会真实联系 HR，不是 dry-run。** 先把 perRun 设为 1，核对公司、文案与送达回执，再扩大额度。测试通过不代表平台端到端行为已验证。

## 持续运行

服务模板见 `deploy/`。把 `@ROOT@`、`@USER@`、`@NODE@`、`@PYTHON@` 替换为部署路径、运行用户和真实可执行文件路径后，审核再安装到 `/etc/systemd/system/`。同一用户必须能读取项目私密文件并使用自己的 Codex 登录；Codex 路径在 agent.json 配置。

不要在已有求职服务的服务器上直接覆盖同名 unit。不要同时运行旧控制器与新 Harness。首次部署先只运行 scheduler；需要外部自动恢复时再部署 watchdog，其启动/重启 systemd 服务需要管理员权限。Telegram 服务为可选项，未绑定时不要启动。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now job-agent-scheduler.service
node scripts/agent-status.mjs
node scripts/harness-state.mjs enqueue
```

暂停/恢复入口为 `node scripts/agent-control.mjs pause|resume`，维护为 `node scripts/agent-control.mjs maintenance 15`；这些操作会调用 systemctl，部署用户必须具备对应 unit 的管理权限。不要给予任意 systemctl/shell sudo 权限；由部署管理员配置最小权限，或在确认状态后由管理员执行。停止/维护可能中断在途发送，未知结果必须核对。

## Telegram：查询桥梁，可选

通过私密文件保存 token，权限 0600，不把 token 写进 shell 历史、提示词或 Git。`memory/telegram-secrets.json` 结构为 `{"token":"你的令牌"}`。`memory/telegram-config.json` 可以填写本人核实的私聊 `chatId`，或通过现有配对流程设置 `pairCode`、`pairIssuedAt`、`pairExpiresAt`，向机器人发送 `绑定求职<配对码>` 后运行 telegram-notify 完成绑定。禁止使用猜测或来自群聊的 ID。

`/status` 不调用模型；自然语言问答使用同一模型配置；`/run` 只入队，不绕过暂停和额度。只主动推送扫码/人机验证提醒，不播报每步操作或周期总结。绑定后再启用 Telegram unit。服务器断网时无法立即推送。

## 目录与边界

- `src/workflows/`：搜索、首次联系、集中回复、决策与统计。
- `src/harness-store.js`：SQLite WAL/FULL、事务、请求、租约。
- `src/visible-tools.js`：可见 UI 操作与原生网络响应证据；当前发送不是直接重放私有消息 API。
- `scripts/`：生命周期、初始化、调度与诊断。
- `prompts/`：表达、事实及数据/指令边界；不会硬编码某个求职者姓名。
- `test/`：离线测试，不应访问真实账号或发送消息。
- 旧 Web/API 控制器、试投脚本、旧审稿提示词没有纳入公开版；只有一套默认执行链路。

## 已知不足 / 优先完善项

- 翻页/滚动可能没有返回更多岗位，不能据此宣称全站已刷完。
- 收件箱轮询目前覆盖已在账本确认的联系人，不是所有陌生人的全量未读消息。
- 自动附件路径有实现和 mock 测试，但缺少广泛真实场景验证；同样不能承诺全链路无人值守。
- 未知发送只隔离，没有自动化完整对账工具；平台 DOM/接口变更可能导致暂停。
- 提示词不能保证模型永远准确；没有文案规则拦截或第二次审稿，使用者承担审核个人资料与观察输出的责任。
- Codex 额度、网络、验证、账号限制都可能让任务暂停；没有自动切换其他付费模型。
- 当前不是一键跨平台安装器，没有 Web 配置面板。systemd 最小权限需按部署环境配置。

## 交给 Agent 安装的提示词

复制以下内容给你自己的安装 Agent：

```text
请部署 https://github.com/xirichuyi/boss-job-agent 。先读 README、SECURITY、config 和 deploy 模板，并检查本机系统、Node/Python、Codex CLI 登录、模型权限以及已有服务；不要覆盖现有项目、数据库、浏览器用户目录或 systemd unit。

先给出具体变更清单，再安装缺少的依赖。代码放在我确认的 /opt 工作目录；Chromium 用非 root 用户和独立用户目录。模型/推理强度只改 config/model.json；城市、城市代码、公司规模、关键词、频率、额度、附件名、CDP 和网页地址只改 config/agent.json，不写死进代码或提示词。读取我提供的真实资料到私密 candidate-profile.md；不要推测学历、经历、薪资或到岗承诺。密钥仅保存于 0600 的本地私密配置，不输出、不提交。

运行 npm ci、Node/Python 测试和安全初始化。配置浏览器仅本地监听，通过 SSH 隧道或有身份认证的网关让我人工扫码；不绕过验证码，不关闭 Chromium sandbox，不直接暴露 CDP/VNC/noVNC。先做只读健康检查，核对原生筛选和平台附件文件名。

默认保持 enabled=false、automationReady=false。未经我明确确认，不执行 enable --confirm-real-sends、scheduler.py --once 或任何真实发送。不要为了测试消耗求职额度。Telegram 可选，只回复查询和推送人工验证提醒；验证私聊所有者后再绑定。

授权后先用 perRun=1 验证一轮，区分文本沟通、回复与附件发送，以平台送达回执验收，不把 active/completed 当成已投递。随后安装审核过的 systemd 模板，配置最小权限并验证重启、暂停和状态查询。给我交付路径、配置清单、服务状态、实际测试结果、未验证项和恢复办法；不要声称已经实现绝对无人值守。
```

## 开源与隐私

MIT。个人简历、聊天账本、历史日志、令牌和浏览器目录不在仓库。详见 [SECURITY.md](SECURITY.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。
