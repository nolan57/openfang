# 方案B vs OpenClaw Cron 核心调度功能对比

## 功能对比表

| 维度 | OpenClaw Cron | 方案B (MCP Server) | 差异 |
|------|---------------|-------------------|------|
| **调度核心** | | | |
| Cron 表达式 | ✅ 使用 croner 库 | ✅ 使用 croner 库 | 相同 |
| 一次性任务 (at) | ✅ atMs 时间戳 | ✅ atMs 时间戳 | 相同 |
| 间隔任务 (every) | ✅ everyMs | ✅ everyMs | 相同 |
| 时区支持 | ✅ tz 参数 | ✅ tz 参数 | 相同 |
| | | | |
| **任务执行** | | | |
| Agent 执行 | ✅ 内置 IsolatedAgent | ✅ opencode run | OpenClaw 更紧密 |
| System Event | ✅ 支持 | ✅ 支持 | 相同 |
| Agent Turn | ✅ 支持 | ✅ 支持 | 相同 |
| Model 覆盖 | ✅ 支持 | ✅ opencode run 指定 | OpenClaw 更灵活 |
| Timeout | ✅ 配置 timeoutSeconds | ✅ opencode run 控制 | 相同 |
| | | | |
| **消息分发** | | | |
| Channel 推送 | ✅ 内置 channel 路由 | ✅ qqbot_send | 方案B更直观 |
| Webhook | ✅ 支持 | ✅ fetch/curl | 相同 |
| 私聊 (C2C) | ✅ 支持 | ✅ qqbot_send | 相同 |
| 群聊 | ✅ 支持 | ✅ qqbot_send | 相同 |
| Best Effort | ✅ 支持 | ✅ 手动处理 | OpenClaw 更完善 |
| | | | |
| **持久化** | | | |
| 存储方式 | JSON 文件 | JSON 文件 | 相同 |
| 位置 | ~/.openclaw/cron.json | 可自定义 | 方案B更灵活 |
| 迁移支持 | ✅ 版本迁移 | 需自行实现 | OpenClaw 更完善 |
| | | | |
| **可靠性** | | | |
| 并发控制 | ✅ maxConcurrentRuns | ✅ 可配置 | 相同 |
| 错误重试 | ✅ 指数退避 | ✅ 指数退避 | 相同 |
| 单次自动禁用 | ✅ deleteAfterRun | ✅ deleteAfterRun | 相同 |
| 状态追踪 | ✅ 完整状态机 | ✅ 完整状态机 | 相同 |
| 锁机制 | ✅ 文件锁 | ✅ 文件锁 | 相同 |
| | | | |
| **运维** | | | |
| UI 管理 | ✅ Web 界面 | ❌ 无 | OpenClaw 完胜 |
| 日志查看 | ✅ Web 界面 | ❌ 需看日志文件 | OpenClaw 完胜 |
| 健康检查 | ✅ cron.status | ✅ 需自行实现 | OpenClaw 更完善 |
| Session 清理 | ✅ 自动清理 | 需手动/定时 | OpenClaw 更完善 |
| | | | |
| **集成度** | | | |
| 与 Gateway | 内置 | 外部调用 | OpenClaw 更紧密 |
| 与 Channel | 内置路由 | 外部调用 | OpenClaw 更紧密 |
| 与 Skills | Skill 集成 | Skill + MCP | OpenClaw 更紧密 |
| 与 ACL/权限 | 内置 | 需自行实现 | OpenClaw 更完善 |

---

## 架构对比

### OpenClaw Cron

```
┌─────────────────────────────────────────────────────────────┐
│                      OpenClaw Gateway                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   CronService                        │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────────────────┐ │   │
│  │  │ Store   │  │ Timer   │  │ IsolatedAgent       │ │   │
│  │  │ (JSON)  │  │ (setTimeout)│ │ (runEmbeddedAgent) │ │   │
│  │  └─────────┘  └─────────┘  └─────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Channel Router                          │   │
│  │   ┌──────┐  ┌──────┐  ┌──────┐  ┌──────────┐    │   │
│  │   │Slack │  │Telegram│ │Discord│  │  QQBot   │    │   │
│  │   └──────┘  └──────┘  └──────┘  └──────────┘    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 方案B (MCP Cron Server)

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Cron Server                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────────────────┐ │   │
│  │  │ Store   │  │ Timer   │  │ Job Executor        │ │   │
│  │  │ (JSON)  │  │ (setInterval)│ │ (child_process)  │ │   │
│  │  └─────────┘  └─────────┘  └─────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              External Calls                          │   │
│  │   ┌─────────────────┐  ┌────────────────────────┐  │   │
│  │   │ opencode run    │  │ qqbot_send (via MCP)  │  │   │
│  │   └─────────────────┘  └────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 关键差异分析

### 1. 集成方式

| 方面 | OpenClaw | 方案B |
|------|----------|-------|
| 执行 Agent | 直接调用内部方法 | 启动子进程 |
| 发送消息 | 内置 Channel Router | 调用 MCP 工具 |
| 延迟 | 低 (~ms) | 中 (~1-2s) |

### 2. 灵活性

| 方面 | OpenClaw | 方案B |
|------|----------|-------|
| 自定义执行逻辑 | 需修改源码 | MCP 代码可自定义 |
| 存储位置 | 固定 | 可配置 |
| 通知渠道 | 内置 Channel | 任意 CLI/API |
| 扩展性 | 受限于内置 Channel | 可调用任意服务 |

### 3. 运维复杂度

| 方面 | OpenClaw | 方案B |
|------|----------|-------|
| 部署 | Gateway 附带 | 独立进程 |
| 监控 | Web UI | 需自行实现 |
| 日志 | 集中管理 | 分散在 MCP + OpenCode |
| 故障恢复 | Gateway 统一处理 | 需自行处理 |

---

## 功能实现差异

### Job 定义

**OpenClaw:**
```typescript
type CronJob = {
  id: string;
  agentId?: string;
  name: string;
  schedule: CronSchedule;
  payload: CronPayload;
  delivery?: CronDelivery;
  state: CronJobState;
};
```

**方案B:**
```typescript
interface CronJob {
  id: string;
  name: string;
  schedule: CronSchedule;
  payload: {
    kind: 'agentTurn' | 'systemEvent';
    message: string;
    deliver?: boolean;
    channel?: string;
    to?: string;
  };
  options?: {
    deleteAfterRun?: boolean;
    retry?: boolean;
    maxRetries?: number;
  };
  state: CronJobState;
}
```

### 执行流程

**OpenClaw:**
```
Timer 触发 → IsolatedAgent.run() → Channel Router → QQ/Slack/Discord
```

**方案B:**
```
Timer 触发 → spawn('opencode run') → MCP qqbot_send → QQ
```

---

## 总结

| 维度 | 优势方 | 说明 |
|------|--------|------|
| 功能完整性 | OpenClaw | 完整的 UI、监控、Channel 集成 |
| 灵活性 | 方案B | 可自定义执行逻辑、通知方式 |
| 部署复杂度 | OpenClaw | Gateway 统一管理 |
| 运维成本 | OpenClaw | Web UI 直观 |
| 延迟 | OpenClaw | 进程内调用 |
| 可扩展性 | 方案B | 可接入任意服务 |

---

## 结论

**方案B可以实现 OpenClaw 核心调度功能的 90%**，主要差异在于：

1. **UI 管理** - 方案B 无 Web 界面
2. **集成度** - OpenClaw 更紧密，延迟更低
3. **运维** - OpenClaw 更省心

对于**纯调度执行**来说，两者功能等价。方案B 更适合：
- 自定义通知场景
- 需要接入非标准 Channel
- 作为其他系统的调度中心
