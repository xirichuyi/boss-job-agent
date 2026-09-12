# BOSS Job Agent

用 Codex 和可视化 Chrome/Chromium 定时找工作：搜索岗位、读取 JD、结合简历打招呼，并处理已核实的 HR 会话和简历请求。

实验性自托管项目，主要支持 Linux。默认不发送；扫码、人机验证需要本人处理。不保证平台始终可用。

## 交给 Agent 安装的提示词

复制下面这段，填写自己的需求即可：

```text
请安装 https://github.com/xirichuyi/boss-job-agent，先读 README、SECURITY 和 docs/DEPLOYMENT-ACCEPTANCE.md。
1. 确认我的目录、求职偏好、模型、简历和平台附件名。支持的全新 Linux 主机把项目放 /opt 下，执行 sudo bash scripts/install-system.sh 自动安装必需环境；使用非 root 用户完成 Codex 登录，不复制作者账号。已有安装先暂停、等在途任务结束并备份 SQLite/配置，禁止重新初始化或覆盖。
2. 新安装执行 npm ci、npm run check、npm run test:install。按 docs/INSTALL.md 使用 npm run install:agent 创建工作区，通过 status/continue 查看进度；工作区独立生成 BOSS_CONFIG_DIR 和 BOSS_DATA_DIR。支持先扫码、后填写资料，路径、模型、偏好写配置，不改源码。
3. 浏览器目录用 BOSS_RPA_DATA_DIR；浏览器桌面也需常驻。CDP/VNC只本地监听，通过 SSH 或认证网关让我扫码，不关闭 sandbox、不擅自开放公网端口。运行 doctor/health/status 核对。
4. 首次 perRun=1，等待明确授权后通过 accept 执行单轮，以定制正文和送达回执验收；随后 activate 展示并确认正式每轮人数、间隔、每日上限。回复、附件、验证恢复没有真实场景就标记未验证，不伪造聊天。
5. 验收后按 deploy 模板配置常驻服务，终端和服务使用相同目录与用户；不覆盖已有服务。交付版本、路径、暂停/恢复命令和未通过项。Telegram可选，不逐步播报。
```

## 安装

### 一键准备必需环境

将项目下载到 `/opt` 下，在项目目录执行：

```bash
sudo bash scripts/install-system.sh
```

支持 Debian 12/13（amd64/arm64）、Ubuntu 22.04/24.04（amd64），需要 systemd 和网络。自动安装 Node 24、Codex、Chrome/Chromium、远程桌面、中文字体、PDF/Word 转换工具及项目依赖，创建非 root 用户和服务，启动扫码桌面。已有可用程序会复用，不复制登录凭据、不开放公网端口。

完成后运行 `sudo boss-agent configure` 填偏好，`sudo boss-agent profile --paste` 粘贴简历；终端会显示后续确认、登录和扫码步骤。`sudo boss-agent status` 查看进度。**环境装好不等于已开始投递，账号登录、扫码和真实发送仍需本人授权。**

`--plan` 只查看计划；失败后重跑同一命令。不覆盖其他部署、资料或修改过的服务。更多说明见 [安装流程](docs/INSTALL.md)。

### 手动安装

自行准备 Linux、Node.js 24+、util-linux（flock）、Codex CLI、Chrome/Chromium。无桌面服务器另需 Xvfb、fluxbox、x11vnc、noVNC/websockify、xdpyinfo。

```bash
git clone https://github.com/xirichuyi/boss-job-agent.git
cd boss-job-agent
npm ci
npm run check
```

推荐使用可恢复的统一入口，以最终非 root 服务用户执行：

```bash
npm run install:agent -- init --workspace /自己的可写目录/boss-install
npm run install:agent -- status --workspace /自己的可写目录/boss-install
```

`status` 显示已完成、失败和下一步；中断后用同一目录执行 `continue`。可先启动扫码桌面，再粘贴简历或导入 PDF/Word。完整命令表见 [安装流程](docs/INSTALL.md)。薪资使用**税前元/月**；验收和正式运行参数分别确认。

旧的轻量初始化入口仍保留：准备自己的 `answers.json`（参考 [示例](examples/setup-answers.json)）和真实简历文件：

```bash
npm run onboard -- --answers /绝对路径/answers.json --profile /绝对路径/resume.md --config /绝对路径/boss-config --data /绝对路径/boss-data
```

命令会生成四份配置、复制简历、建立账本，并打印环境变量。**只接受两个独立的新目录，不安装系统软件、不启动浏览器、不授权发送。** 已有安装不要重复运行。

后续终端和服务均设置打印出的 `BOSS_CONFIG_DIR`、`BOSS_DATA_DIR`。核对简历和配置后：

```bash
npm run doctor -- --offline
```

也可用 `npm run setup` 单独生成配置；`--answers 文件 --output 新目录` 支持非交互安装。

### 浏览器与首次运行

以非 root 用户运行 `bash scripts/start-desktop.sh`，先把 `BOSS_RPA_DATA_DIR` 设为该用户可写的独立浏览器目录。已有浏览器则配置本地 CDP 地址。不要使用 `--no-sandbox` 或公开 CDP/VNC 端口。

通过 SSH 隧道或认证网关打开桌面，人工扫码并打开 BOSS 岗位页、聊天页。附件名必须与 `agent.json.resumeFile` 一致。

```bash
npm run doctor
npm run health
npm run status
# 本人确认资料、筛选和真实发送授权后执行：
node scripts/enable.ts --confirm-real-sends
node scripts/scheduler.ts --once
```

最后一条会真实联系 HR。确认平台出现定制正文和送达回执后，再按 [部署说明](docs/DEPLOYMENT-ACCEPTANCE.md) 配置常驻服务。`completed` 不等于发送成功。

## 配置与管理

| 配置文件 | 内容 |
| --- | --- |
| agent.json | 公司规模、关键词、额度、附件名、浏览器和 Codex 路径 |
| job-filters.json | 城市、薪资、实习排除、平台筛选档位 |
| model.json | 模型和推理强度 |
| execution.json | 并行、超时、重试、通知参数 |

配置目录由 `BOSS_CONFIG_DIR` 指定；简历和私密 `memory/` 由 `BOSS_DATA_DIR` 指定。未设置时兼容仓库目录运行。修改配置后先暂停并等在途任务结束，再重启；用 `npm run status` 确认生效值。

```bash
node scripts/agent-control.ts pause
node scripts/agent-control.ts resume   # systemd 部署
# 前台运行改用 resume --state-only，再执行 npm start
```

搜索与回复并行，聊天操作串行核对身份；失败按联系人隔离，发送结果不明时只对账、不盲目重发。陌生或人工联系但未核实 JD 的会话不会自动回复。扫描受预算限制，不保证遍历全部岗位或消息。

Telegram 可选，用于查询状态、请求运行和接收验证/恢复耗尽提醒，不逐步通知。配置细节见 [运行配置](docs/RUNTIME-CONFIG.md)，代码结构见 [架构说明](ARCHITECTURE.md)。

升级前暂停、等待当前轮次结束，备份 SQLite 和私密配置；不要重新 init。`npm run test:install` 可验证隔离安装，不连接浏览器、不发送消息；真实回复和附件仍需现场验收。

## 开源

MIT。简历、聊天、令牌和浏览器数据禁止提交；公开日志前脱敏。见 [安全说明](SECURITY.md)、[贡献指南](CONTRIBUTING.md)。

[Linux DO 社区](https://linux.do/)
