# 代码架构

TypeScript 模块化单体，Node.js 24 直接执行源码，无 dist。单账号共享浏览器和 SQLite，不需要拆成多个业务服务。

## 目录职责

| 目录 | 职责 |
| --- | --- |
| scripts | 安装、初始化、运行、查询等 CLI 入口 |
| src/config | 配置加载、校验、生效视图 |
| src/installation | 安装进度、资料导入编排、验收与正式启用、服务模板生成 |
| src/domain | 业务契约、筛选与恢复规则，不访问外部系统 |
| src/application | 搜索、联系、回复、附件、对账的业务编排 |
| src/adapters | 浏览器、模型、Telegram 协议适配 |
| src/storage | SQLite 事务、账本、兼容 JSON 导出 |
| src/runtime | 调度、进程监督、互斥、健康检查 |

入口装配业务与适配器；浏览器适配器不启动调度器。现有 application 仍有直接配置/存储依赖，尚非全面依赖注入。

## 执行链路

```text
scheduler → scheduled-agent → run-cycle → cycle-runner
                                          ├─ 搜索 → JD → 批量生成 → 联系
                                          └─ 恢复/对账 → 收件箱 → 回复/附件
```

两条业务分支共享一个租约、账本与额度。搜索和收件箱使用不同标签页；聊天操作经过优先级互斥锁，已开始的发送不被打断。模型在后台线程执行，调用串行，避免阻塞浏览器事件或争用用量记录。

## 浏览器适配层

- `cdp.ts`：连接、协议调用、允许的只读请求。
- `visible.ts`：页面操作编排；等待预算来自 execution.browser。
- `detail-view.ts`、`conversation-view.ts`：岗位和联系人身份核对。
- `chat-history.ts`：统一消息快照，供历史比较和发送核对复用。
- `resume-dialog.ts`：可见弹窗定位、已关闭弹窗的动画残留恢复。
- `pagination.ts`：翻页和列表增长检测。

个人偏好、程序路径和运行预算归配置；平台 DOM、协议字段和安全校验归适配器。不要把平台兼容细节暴露为用户开关。

## 持久化与恢复

SQLite 使用 WAL、FULL 同步及事务。发送前保存意图，送达后提交回执；未知结果保留隔离和额度，只对账、不盲目重发。人工回复优先，旧草稿必须重新核对历史和资料指纹。

单联系人失败不阻塞其他联系人；验证、暂停、租约失效和关键存储错误禁止后续发送。所有分支收尾后才提交最终状态。没有平台幂等键，不保证端到端 exactly-once。

运行预算在 execution.json；默认进程监督超时15分钟，先 TERM 再 KILL 子进程组。Linux flock 和 SQLite 租约防止重复执行。Telegram、watchdog 为可选辅助服务。

## 配置、升级与验证

CODE_ROOT 确定源码位置；BOSS_CONFIG_DIR 放四份配置，BOSS_DATA_DIR 放简历和账本，BOSS_RPA_DATA_DIR 独立存浏览器资料。旧 BOSS_AGENT_ROOT 仅兼容数据根。配置生效范围见 [运行配置](docs/RUNTIME-CONFIG.md)。

新安装使用 `install:agent`；独立 desktop.json 支持先扫码。安装工作区绑定运行用户，阶段验收绑定配置指纹；默认禁发，正式额度与首轮验收分开。流程见 [安装说明](docs/INSTALL.md)。

升级先暂停、等在途任务结束，用 SQLite backup 接口备份账本及私密配置，再替换完整源码；不要重新 init 或回退已发送记录。尚无自动升级/回滚器。

`npm run check` 执行类型检查和回归；监督器、公共契约额外使用 strict，平台动态字段尚有宽类型。`npm run test:install` 在隔离目录检查新安装，不连接浏览器、调用模型或发送消息。真实平台验收见 [部署说明](docs/DEPLOYMENT-ACCEPTANCE.md)。
