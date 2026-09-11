# 运行链路与失败边界

架构选择、依赖边界和迁移债务以 [ADR 001](docs/ARCHITECTURE-DECISION.md) 为准。当前为增量迁移中的 TS 模块化单体，不是已全面解耦的最终状态。

## TypeScript 分层

```text
scripts/                 薄 CLI 入口：加载配置、启动、授权、查询
src/config/              配置加载、验证与生效视图
src/domain/              业务契约、筛选规则、恢复决策
src/application/         搜索、联系、收件箱、单联系人处理、对账
src/adapters/browser/    CDP、页面定位、原生筛选与送达核对
src/adapters/model/      模型调用、提示词、上下文、额度
src/adapters/telegram/   查询与通知通道
src/storage/            SQLite 账本与兼容 JSON 导出
src/runtime/            TS 调度、子进程监督、互斥、健康检查
```

收件箱批量扫描/游标留在 application/inbox.ts；单联系人附件、回复草稿及发送放在 inbox-contact.ts，经 ChatPort、decide、save、assertAuthority 注入能力。进程监督模块不导入浏览器或业务工作流。入口可以组装这些层，禁止让浏览器适配器自行启动调度器。

单联系人流程通过 `InboxServices` 注入简历文件名、筛选、上下文指纹、告警和时钟；`runtime/inbox-services.ts` 绑定真实配置/文件。上下文每次读取，不缓存人工修改的简历和提示词；指纹算法保持兼容已有草稿。`ReplyDraft`、`InboxRetry` 有显式类型。当前批量入口仍负责默认装配，历史读取重试/对账仍依赖既有模块，并非所有层都已完全解耦。

`npm run typecheck` 检查全部运行源码；监督器与公共契约额外开启 strict 检查。历史动态平台字段尚保留显式宽类型，逐步收紧，不使用 ts-nocheck 或关闭编译检查来伪装迁移完成。测试以 Node 原生 TS 支持执行。没有独立 dist 目录，避免源码/产物混用。

## 从旧版升级

暂停并等周期结束后备份代码、完整数据库和 unit；部署完整 TS 源码、保留私密配置/profile/memory。scheduler 的 ExecStart 改为 Node + scripts/scheduler.ts，Telegram/watchdog 的入口后缀同样改为 .ts。不要只替换一部分文件，不同时启动 Python/JS 旧入口。旧代码移到备份，不重新 init。节点安装与检查统一用 npm ci、npm run check；随后 doctor/health/status，通过后恢复授权。Linux 仍需要 util-linux 的 flock；不再需要 Python 运行应用。

监督参数在 execution.json.supervisor，旧配置缺少此节时兼容既有默认值；默认15分钟硬超时，TERM后10秒KILL整个子进程组，systemd TimeoutStopSec 应大于清理宽限。仅回退代码不等于可以回退账本，禁止丢弃升级期间已发送记录。

配置入口：config/files.ts 统一解析 BOSS_CONFIG_DIR，config/effective.ts 汇总实际生效值与旧字段提示。model.json → 模型/推理；agent.json → 业务参数；job-filters.json → 城市/薪资/类型；execution.json → 并行/恢复；私密资料 → profile。进程级配置快照避免调用中途改变模型导致回执或冷却记录错配。SQLite 只持久化运行授权、执行进度、额度、请求和账本，不再复制模型/频率参数。

| 阶段 | 入口 | 失败处理 |
| --- | --- | --- |
| 初始化 | init.ts | 默认关闭真实发送，已有数据库拒绝覆盖 |
| 定时唤醒 | scheduler.ts | OS 文件锁，单轮15分钟，终止整个子进程组 |
| 派发 | scheduled-agent.ts | 先检查暂停、维护、限额、上轮恢复；SQLite租约防并发 |
| 搜索 | application/search.ts | 配置关键词轮换，原生城市/规模筛选，核对响应证据 |
| 首次联系 | application/outreach.ts | 先读JD与公司历史，最多3项一次生成，再逐条确认当前JD/历史/额度 |
| 写入 | visible-tools.ts | 先持久化意图再点击；未知结果隔离，禁止盲重发 |
| 回复/附件 | application/inbox.ts | 扫描联系人列表与未读标记；已确认联系人轮询优先未读，陌生人进入待核实记录；附件按配置文件名及平台回执 |
| 对账 | application/reconcile.ts | 只读核对发送前ID基线与唯一新送达消息；确认后恢复联系人，不重放、不追补历史发送计数 |
| 结果 | application/summary.ts | 区分真正送达、正常零发送、模型异常和执行阻塞 |
| 恢复 | watchdog.ts | 独立观察服务，尊重暂停/维护，重启不解除发送隔离 |
| 查询 | telegram-chat.ts | 独立私聊授权、持久化问答队列，不直接操作浏览器 |

SQLite采用WAL、synchronous FULL、事务提交额度+周期、意图+账本、回执+终态。没有平台幂等键，不宣称端到端 exactly-once。模型生成超时可能导致本岗位跳过待重试，限额会让同模型冷却；不自动切换付费模型。

## 单周期内的并行

`run-cycle.ts` 管理租约、持久化与收尾，`application/cycle-runner.ts` 在同一 Harness 租约内编排 search / inbox 两个异步分支，共享唯一账本、联系人额度与结果计数；不是两个独立进程各自投递。默认由 `config/execution.json` 开启。

- 搜索使用岗位标签页，收件箱使用聊天标签页；聊天方法统一经过 `task-coordinator.ts` 的优先级互斥锁。
- 收件箱释放聊天锁后才生成回复。模型等待由 `async-decision.ts` 的后台线程承担，主事件循环仍能处理 CDP；模型调用单队列，避免冷却状态并发覆盖。
- 首次联系的“平台历史复查 → 点击联系 → 核对默认招呼 → 补充消息送达”持有同一把可重入聊天锁，防止 HR 回复任务中途切换对象。
- 发送前仍重新核对联系人与聊天历史。任一分支致命失败后禁止后续写入；等待所有分支安全结束再关闭 CDP 和提交终态，不能用会提前返回的 Promise.all 直接收尾。
- 优先级只影响排队任务，不打断已经开始的发送。并行不会增加每日联系限额，也不绕过登录验证或结果未知隔离。

JSON是兼容导出。备份请用SQLite backup接口；不要只复制主数据库而遗漏未checkpoint的WAL。回退旧账本可能重复联系，恢复前必须核对回退期间的发送记录。

模型冷却由 available-decision.ts 转为可重试的延后生成结果，不让派发器提前退出；无模型的读取、对账和已存正文恢复继续。pause/maintenance 只撤销新发送授权，不强杀等待回执的进程；收尾将尚未执行的 prepared 意图取消，已经执行的 unknown 意图保留待核实。TypeScript runtime/process-supervisor.ts 承担进程组硬超时与退出清理；Linux flock 仍提供操作系统级互斥。

部署边界与开源版复现步骤见 [部署验收](docs/DEPLOYMENT-ACCEPTANCE.md)。CODE_ROOT 从模块路径确定；BOSS_DATA_DIR 指定个人资料和 memory 数据根，兼容旧 BOSS_AGENT_ROOT 别名。调度子进程和模型 schema 固定从代码根加载，配置目录由 BOSS_CONFIG_DIR 指定。未设置环境变量时保留原地安装行为。现有数据不会自动搬迁；统一版本发布和回滚仍未实现。

`npm run test:install -- /opt/work_projects` 在新隔离目录执行 npm ci、全量检查、私密配置生成、默认关闭初始化、单次关闭发送调度和重复初始化拒绝验收，保留 acceptance.json。不会启用浏览器、模型或真实发送。该验收不替代线上浏览器故障演练。

无法由单元测试证明：平台未来DOM稳定、跨所有账号的附件选择正确、所有未读覆盖、网络断开后的真实送达状态。详见README已知不足，部署者需在明确授权后逐项做有限真实验证。
