# 运行参数配置

编辑 `config/execution.json`（自定义目录使用 `BOSS_CONFIG_DIR`），执行 `npm run doctor` 检查。部署中请先暂停并等待本轮结束，再重启相应服务；不要假定所有参数均能热更新。`status` 的 effective 配置展示补齐默认值后的执行配置。

旧配置没有新增 section 时沿用旧行为；公开配置列出完整默认值。下面两个 section 拒绝未知字段、非正整数、越界值；错误不会悄悄回退默认值。令牌仍放私密 memory 文件，绝不放公开配置。

## execution.browser

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| discoveryTimeoutMs | 5000 | 读取 Chrome 标签列表超时 |
| connectTimeoutMs | 5000 | CDP WebSocket 握手超时 |
| commandTimeoutMs | 20000 | 单次 CDP 命令超时 |
| apiReadTimeoutMs | 12000 | 页面内只读 API 请求超时，必须小于命令超时 |
| navigationChecks | 10 | 导航后只读核对次数，最多100次，不重复导航 |
| navigationPollMs | 500 | 核对间隔，最多10000毫秒 |
| viewTimeoutMs / viewPollMs | 20000 / 700 | 页面控件等待上限与轮询间隔 |
| contactSearchDelayMs | 1200 | 输入联系人搜索词后的等待 |
| conversationScrollDelayMs | 500 | 联系人列表滚动后等待 |
| controlTimeoutMs | 5000 | 联系人列表和发送按钮就绪等待 |
| receiptTimeoutMs | 25000 | 文字或附件送达回执等待 |

各值为正整数，最多120000毫秒。旧配置未填写新增字段时沿用默认值。增大等待时间仍受整轮执行预算限制。

## execution.telegram

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| pollMs | 3000 | 查询轮询间隔，1000–300000毫秒 |
| requestTimeoutMs | 10000 | 请求超时，最多60000毫秒 |
| updatesPerPoll | 50 | 每次获取消息数，最多100 |
| historyEntries | 50 | 保留的问答轮数，最多1000 |
| answerMaxChars | 3500 | 模型回答截断长度，最多3500 |
| questionMaxChars | 8000 | 入队问题截断长度，最多32000 |
| alertReasonMaxChars | 350 | 通知原因截断长度，最多1000 |
| alertsPerFlush | 1 | 每轮最多通知数，最多10 |
| replyRetryMinSeconds / replyRetrySeconds | 30 / 60 | 回复重试最短/默认等待 |
| alertRetryMinSeconds / alertRetrySeconds | 60 / 300 | 告警重试最短/默认等待 |

默认重试时间不得小于最短时间或超过86400秒。平台返回 retry_after 时优先遵守平台等待时间。截断长度采用 JavaScript 字符串单位。仅原有扫码/验证和恢复耗尽告警可主动通知，不增加逐步骤播报。

## 个人配置

向导答案支持 `browserBinary`、`codexBinary` 绝对路径；`cities` 可填内置城市名称，或 `{"name":"上海","code":"101020100"}` 这样的对象，不局限于示例城市。自定义城市需核对平台编码。薪资和实习排除在 job-filters.json 中修改；模型在 model.json 中修改，不自动切换模型。

浏览器桌面环境变量：`BOSS_RPA_DATA_DIR`（独立可写目录）、`DISPLAY_NUMBER`、`SCREEN_SIZE`、`NOVNC_WEB_ROOT`、`START_URL`。CDP/VNC/noVNC 端口来自 agent.json，保持本地监听。

可选项目资料：数据目录 `memory/candidate-projects.json`，格式为 `{"source":"来源","projects":[{"name":"项目名","description":"本人工作","url":"公开链接"}]}`。最多40项、16000个JSON字符；先核实再添加，不存凭据。更新资料会使旧回复草稿失效。

Telegram 令牌放 `memory/telegram-secrets.json`：`{"token":"自己的令牌"}`；私聊绑定放 `memory/telegram-config.json`，权限0600。填写本人核实的 chatId，或配置 pairCode、pairIssuedAt、pairExpiresAt 后私聊配对，不从群聊绑定。`/status` 查状态，`/run` 入队，不绕过暂停或额度。

## 不提供关闭开关的规则

域名/接口白名单、私聊身份核验、发送前落账、未知结果不重发属于安全约束，不提供关闭开关。单位换算、协议字段也不是用户配置。

平台选择器、岗位标签和消息结构留在 browser adapter；它们属于平台兼容逻辑，不是个人配置。变更须补测试。重定位仅重读一次，未知发送不自动重发。
