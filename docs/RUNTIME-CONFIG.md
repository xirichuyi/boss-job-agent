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

单个超时最多120000毫秒。以上控制 CDP 基础层，不代表所有页面控件等待都已配置化。

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

## 保留在代码中的规则与后续范围

域名/接口白名单、私聊身份核验、发送前落账、未知结果不重发属于安全约束，不提供关闭开关。单位换算、协议字段也不是用户配置。

本轮没有宣称清完所有硬编码。页面控件等待/定位重试、模型上下文各片段预算仍需逐项梳理；调整时必须补测试，不能机械地把所有数字都变成可调开关。
