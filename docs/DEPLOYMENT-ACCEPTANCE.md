# 复现已有工作流程：部署与验收

部署流程：配置和简历 → 浏览器扫码 → 单轮真实验收 → 常驻运行。每个账号需要独立验收，不能沿用作者账号的测试结果。

## 一套完整目录、一套运行身份

新用户使用完整 checkout，例如 `/opt/work_projects/boss-job-agent`。代码和 scripts 固定从 checkout 加载；candidate-profile.md、memory 可放在独立的 BOSS_DATA_DIR 中；私密四份配置通过 BOSS_CONFIG_DIR 指定。未设置时兼容代码目录原地运行。BOSS_AGENT_ROOT 是旧数据目录别名，BOSS_DATA_DIR 优先。现有数据不会自动迁移，不得指向空目录重新 init 来代替升级。

以同一个非 root 服务用户完成安装、Codex 登录、配置、初始化和常驻运行。浏览器独立用户也可以，但目录权限和本地 CDP 可达性须另行验证。不要复制作者的登录态、令牌或账本。Codex 是子进程调用，不依赖一直打开的交互会话或 tmux。

按 README 用 onboard 初始化新目录，再完成 browser/doctor。已有安装不要 onboard 或 init。doctor 不验证模型额度、附件或送达。agent.json 中 codex.binary 和 browser.binary 填本机可执行文件绝对路径；systemd 不加载交互 shell 的 PATH。Node.js 使用模板中的绝对路径，浏览器启动器也需配置正确 PATH。

## 流程对应与验收证据

| 本地已有流程 | 开源入口 | 验收依据 |
| --- | --- | --- |
| 本人资料和偏好 | candidate-profile.md、BOSS_CONFIG_DIR 四文件 | status 显示实际城市、薪资、模型和来源；人工核实资料 |
| 扫码与看浏览器 | start-desktop.sh、CDP、SSH/认证网关 | 本人能看到浏览器，岗位/聊天页已登录 |
| 定时唤醒 | scheduler.ts → scheduled-agent.ts | 心跳更新；等待时间、暂停、额度正确；不能只看 service active |
| 刷岗、读 JD | application/search.ts | 原生筛选响应证据、读取数量、跳过原因 |
| 首次联系并附话术 | application/outreach.ts | 平台实际出现定制正文，receipts 记录送达；默认招呼不代表正文成功 |
| 回复和附件 | application/inbox.ts | 新 HR 消息被读到、回复送达；附件名与平台一致且有回执 |
| 单人异常不拖停其他人 | application/contact-recovery.ts、application/reconcile.ts | 隔离/重试原因和下次时间；其他联系人继续；未知结果不盲重发 |
| 查询与通知 | telegram-chat.ts、telegram-notify.ts | 可选私聊 /status；无逐步播报；断网不承诺即时告警 |

## 常驻服务必须与终端一致

先替换 deploy 模板的 @ROOT@、@USER@、@NODE@，然后在 scheduler、telegram、watchdog 的 `[Service]` 都加上：

```ini
Environment="BOSS_CONFIG_DIR=/opt/boss-job-agent/config/private-local"
Environment="BOSS_DATA_DIR=/opt/boss-job-agent-data"
```

路径改为本人实际路径。审核用户可读写仓库和私密数据；Codex 登录必须属于实际执行用户。浏览器启动器也传入同一个配置目录。先前台验证，再按 README 安装 scheduler。Telegram 是可选独立服务；watchdog.service 配合 scripts/job-agent-watchdog.timer 安装，但须单独核实它是否有管理 scheduler 的权限，不默认授予任意 sudo。

尚未提供自动安装全部系统服务和软件的工具。不要直接复制未替换占位符的 unit，也不要覆盖服务器已有同名 unit。

## 三层验收，不能混为一谈

1. **代码验证**：`npm test`；包含全新目录初始化、私密配置、TypeScript 监督器调度到派发器、默认禁止发送、暂停/恢复。浏览器和发送单元测试使用模拟平台，不能证明真实账号权限。
2. **现场无发送验证**：同一服务用户执行 doctor/health/status；保持 enabled=false，验证实际后台能加载配置并持久化状态。不能在已授权账号上把 scheduler.ts --once 当作无发送测试。
3. **明确授权后的真实验证**：perRun=1，enable 后单轮执行；查看平台定制正文与送达回执。再以真实 HR 回复验证回复链路、按请求验证附件，最后启用常驻。没有合适回复时该项记“未验证”，不要编造聊天测试。

升级已有部署前暂停并等待周期结束，使用 SQLite backup 接口备份账本、备份配置及当前提交，逐项迁移，不重新 init。暂不提供一键接管作者旧部署；新仓库接旧数据前必须核对 schema、配置、服务路径和历史未知发送状态，避免丢账后重复联系。
