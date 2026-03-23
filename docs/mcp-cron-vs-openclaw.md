# Solution B vs OpenClaw Cron Core Scheduling Feature Comparison

## Feature Comparison Table

| Dimension | OpenClaw Cron | Solution B (MCP Server) | Difference |
|-----------|---------------|-------------------------|------------|
| **Scheduling Core** | | | |
| Cron expressions | ✅ Using croner library | ✅ Using croner library | Same |
| One-time tasks (at) | ✅ atMs timestamp | ✅ atMs timestamp | Same |
| Interval tasks (every) | ✅ everyMs | ✅ everyMs | Same |
| Timezone support | ✅ tz parameter | ✅ tz parameter | Same |
| | | | |
| **Task Execution** | | | |
| Agent execution | ✅ Built-in IsolatedAgent | ✅ opencode run | OpenClaw tighter integration |
| System Event | ✅ Supported | ✅ Supported | Same |
| Agent Turn | ✅ Supported | ✅ Supported | Same |
| Model override | ✅ Supported | ✅ opencode run specified | OpenClaw more flexible |
| Timeout | ✅ Configure timeoutSeconds | ✅ opencode run control | Same |
| | | | |
| **Message Delivery** | | | |
| Channel push | ✅ Built-in channel routing | ✅ qqbot_send | Solution B more intuitive |
| Webhook | ✅ Supported | ✅ fetch/curl | Same |
| Direct message (C2C) | ✅ Supported | ✅ qqbot_send | Same |
| Group chat | ✅ Supported | ✅ qqbot_send | Same |
| Best Effort | ✅ Supported | ✅ Manual handling | OpenClaw more complete |
| | | | |
| **Persistence** | | | |
| Storage method | JSON file | JSON file | Same |
| Location | ~/.openclaw/cron.json | Customizable | Solution B more flexible |
| Migration support | ✅ Version migration | Manual implementation required | OpenClaw more complete |
| | | | |
| **Reliability** | | | |
| Concurrency control | ✅ maxConcurrentRuns | ✅ Configurable | Same |
| Error retry | ✅ Exponential backoff | ✅ Exponential backoff | Same |
| Auto-disable after single run | ✅ deleteAfterRun | ✅ deleteAfterRun | Same |
| State tracking | ✅ Complete state machine | ✅ Complete state machine | Same |
| Lock mechanism | ✅ File lock | ✅ File lock | Same |
| | | | |
| **Operations** | | | |
| UI management | ✅ Web interface | ❌ None | OpenClaw wins |
| Log viewing | ✅ Web interface | ❌ Need to check log files | OpenClaw wins |
| Health check | ✅ cron.status | ✅ Manual implementation required | OpenClaw more complete |
| Session cleanup | ✅ Automatic cleanup | Manual/scheduled required | OpenClaw more complete |
| | | | |
| **Integration** | | | |
| With Gateway | Built-in | External call | OpenClaw tighter |
| With Channel | Built-in routing | External call | OpenClaw tighter |
| With Skills | Skill integration | Skill + MCP | OpenClaw tighter |
| With ACL/Permissions | Built-in | Manual implementation required | OpenClaw more complete |

---

## Architecture Comparison

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

### Solution B (MCP Cron Server)

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

## Key Difference Analysis

### 1. Integration Method

| Aspect | OpenClaw | Solution B |
|--------|----------|------------|
| Agent execution | Direct internal method call | Spawn child process |
| Message sending | Built-in Channel Router | Call MCP tool |
| Latency | Low (~ms) | Medium (~1-2s) |

### 2. Flexibility

| Aspect | OpenClaw | Solution B |
|--------|----------|------------|
| Custom execution logic | Requires source code modification | MCP code customizable |
| Storage location | Fixed | Configurable |
| Notification channel | Built-in Channel | Any CLI/API |
| Scalability | Limited to built-in Channel | Can call any service |

### 3. Operations Complexity

| Aspect | OpenClaw | Solution B |
|--------|----------|------------|
| Deployment | Gateway included | Independent process |
| Monitoring | Web UI | Manual implementation required |
| Logging | Centralized management | Distributed across MCP + OpenCode |
| Fault recovery | Gateway unified handling | Manual handling required |

---

## Feature Implementation Differences

### Job Definition

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

**Solution B:**
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

### Execution Flow

**OpenClaw:**
```
Timer triggers → IsolatedAgent.run() → Channel Router → QQ/Slack/Discord
```

**Solution B:**
```
Timer triggers → spawn('opencode run') → MCP qqbot_send → QQ
```

---

## Summary

| Dimension | Winner | Description |
|-----------|--------|-------------|
| Feature completeness | OpenClaw | Complete UI, monitoring, Channel integration |
| Flexibility | Solution B | Customizable execution logic, notification methods |
| Deployment complexity | OpenClaw | Gateway unified management |
| Operations cost | OpenClaw | Web UI intuitive |
| Latency | OpenClaw | In-process call |
| Scalability | Solution B | Can integrate any service |

---

## Conclusion

**Solution B can achieve 90% of OpenClaw's core scheduling functionality**, with main differences in:

1. **UI Management** - Solution B has no web interface
2. **Integration** - OpenClaw is tighter with lower latency
3. **Operations** - OpenClaw is more hassle-free

For **pure scheduling execution**, both are functionally equivalent. Solution B is more suitable for:
- Custom notification scenarios
- Need to integrate non-standard Channels
- As a scheduling center for other systems
