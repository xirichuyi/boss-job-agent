# 安装与交付

统一入口：`npm run install:agent -- 操作 --workspace 工作区 [选项]`。工作区保存进度、配置、简历和账本；中断后用同一目录执行 `continue`，不要重新 init 数据库。`status` 会区分未安装、已初始化但未运行、正式运行已授权和常驻服务状态。

## 准备运行用户和依赖

推荐在 `/opt` 下的项目目录执行 `sudo bash scripts/install-system.sh`，自动安装下面的必需依赖、创建 `bossagent` 用户、工作区、`boss-agent` 命令和 systemd 服务，只启动桌面。支持 Debian 12/13 amd64/arm64、Ubuntu 22.04/24.04 amd64；不支持无 systemd 的普通容器。需要访问系统软件源、nodejs.org 和 npm；Ubuntu 浏览器还需访问 dl.google.com。不会使用第三方镜像或修改代理。

`--plan` 预览，`--user 用户名` 修改运行用户；复用已有用户必须加 `--reuse-user`。`--codex-version 版本号` 指定缺失 Codex 的安装版本，默认 latest；已有可用 Codex 不升级。安装下载保存在 `/var/lib/boss-job-agent-bootstrap`，私有工具在 `/opt/boss-job-agent-tools`，不替换系统 Node。重复安装拒绝覆盖其他实例或已修改服务，运行中的求职服务必须先安全停止。

后续用 `sudo boss-agent 操作`，自动切换到固定运行用户、Node 和工作区，无须反复填写路径。`configure` 预览后执行 `configure --confirm`；`profile --paste` 粘贴后执行 `profile --confirm`，然后 `initialize`、`login`。其余操作见下表。装好不等于登录成功或发送授权。

手动安装时由管理员准备非 root 用户和依赖；以该用户执行全部命令和 Codex 登录。业务安装器 `install:agent` 不授予 sudo。已存在的工作区绑定创建用户，不自动接管其他用户或作者的旧部署。

需要 Node.js 24+、util-linux/flock、Codex CLI、Chrome/Chromium。无桌面服务器另需 Xvfb、fluxbox、x11vnc、noVNC/websockify、xdpyinfo。PDF 转文字需 `pdftotext`（poppler-utils），DOCX 需 `pandoc`，旧 DOC 需 `antiword`；转换失败可改用粘贴。文件仅本地处理，扫描PDF须先OCR。

## 按阶段执行

以下每条命令都追加 `--workspace /自己的可写目录/boss-install`。路径是你选择的安装工作区，不是简历文件路径。

| 操作 | 作用 |
| --- | --- |
| `init` / `status` / `continue` | 创建工作区、显示进度和下一步；不启用发送 |
| `desktop` | 查看独立 desktop.json，填写本机浏览器路径/端口 |
| `services` | 生成桌面与调度服务模板；不自动安装或覆盖 systemd 服务 |
| `browser-start` | 前台运行非 root 桌面；可以在填简历前扫码 |
| `access --ssh 用户@服务器` | 返回本地电脑执行的 SSH 转发命令及浏览器地址 |
| `browser-check` | 检查BOSS登录/验证状态，不发送消息 |
| `configure` | 交互填写所有常用偏好；非交互用 `--answers 本人答案.json` |
| `configure --confirm` | 保存刚才预览的配置；展示税前元/月和正式人数 |
| `profile --paste` | 粘贴真实正文，以 Ctrl-D 结束；预览并保存草稿 |
| `profile --file 本人文件.pdf` | 导入 MD/TXT/PDF/DOCX/DOC；预览转换结果 |
| `profile --confirm` | 确认刚才的简历草稿，拒绝空白或模板占位内容 |
| `initialize` | 建立默认禁发账本；重复执行不清空已有记录 |
| `login` | 检查当前用户登录，未登录才发起设备登录 |
| `attachments` | 读取当前可见附件名；先手动打开附件选择窗口 |
| `attachment --name 精确文件名 --confirm` | 选择唯一匹配文件并保存配置，不点击发送 |
| `model-check --confirm-model-call` | 用所选模型做一次小请求，消耗少量额度；不自动换模型 |
| `accept --confirm-real-sends` | 单轮最多1位新HR，核对定制正文回执，结束后暂停 |
| `activate` | 预览正式每轮人数、间隔、每日上限 |
| `activate --confirm-real-sends` | 按已确认正式参数授权运行，不自动调用 systemctl |
| `start` / `pause` / `resume` | 前台启动、暂停/恢复业务授权；无需 sudo |

`configure` 的答案示例见 examples/setup-answers.json。`minimumMonthlySalaryYuan: 6000` 表示税前6000元/月；不接受“6/月”。公司规模为固定下限选项。`perRun` 表示正式每轮上限，验收单独固定为1。旧 `minimumMonthlySalaryK` 保留兼容，但不能同时填写两个单位字段。

修改配置或资料后，受影响的验证会失效，status 提示重新核对。文件名匹配和附件真正送达是两个状态；没有真实HR请求时不伪造附件测试。未收到定制正文回执时不进入正式运行。

## 登录与服务

CLI 已安装、当前用户已登录、模型可调用分别检查。[官方登录说明](https://learn.chatgpt.com/docs/auth)提供设备登录与授权缓存迁移方案。需要复用本人登录时，先明确授权，由管理员把本人缓存交给最终用户并设0600权限，再以该用户重做 login/model-check；安装器不复制 root 凭据、不输出令牌。

管理员审核工作区 units/ 模板的 User、目录、Node路径和已有同名服务，再安装。先启动桌面服务；accept 前保持调度服务停止，验收和 activate 完成后再启动调度服务。终端与服务必须使用同一用户、BOSS_CONFIG_DIR、BOSS_DATA_DIR。桌面另用 BOSS_DESKTOP_CONFIG 和 BOSS_RPA_DATA_DIR。

运行用户仅修改工作区授权，不管理 systemd；服务未启动时由管理员启动，或用 start 前台运行。无需授予任意 sudo。status 会核对已安装服务用户和目录，不把其他实例的 active 当成成功。

远程标准方案为 SSH 隧道：CDP/VNC/noVNC 保持本地监听和 Chrome sandbox。公网 HTTPS/认证网关需要部署者额外配置，安装器不改DNS、不默认开放公网。SSH窗口关闭后隧道断开；桌面服务和调度服务可继续运行。
