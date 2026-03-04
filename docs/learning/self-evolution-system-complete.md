# OpenCode 自我进化与长程一致性系统

**版本**: 1.0  
**日期**: 2026-03-04  
**状态**: ✅ 已完成 (100%)

---

## 目录

1. [概述](#概述)
2. [架构总览](#架构总览)
3. [核心模块](#核心模块)
4. [完整流程](#完整流程)
5. [使用指令](#使用指令)
6. [数据模型](#数据模型)
7. [安全机制](#安全机制)
8. [集成方式](#集成方式)
9. [快速开始](#快速开始)

---

## 概述

本系统实现了两个核心能力：

1. **自我进化 (Self-Evolving)** - AI 自动收集信息、分析、生成改进、执行部署
2. **长程一致性 (Long-Range Consistency)** - 跨时间、跨会话的记忆一致性和知识关联

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OpenCode 智能系统                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Layer 1: Researcher (研究层)                    │    │
│  │  ├── Collector: 收集信息 (search/arxiv/github/pypi)              │    │
│  │  └── Researcher: 生成研究提议 (相关性评分/风险评估)               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Layer 2: Architect (规划层)                     │    │
│  │  ├── NegativeMemory: 约束检查 (跳过已知失败)                       │    │
│  │  ├── Architect: 决策 (approve/reject/human_review)               │    │
│  │  ├── ConstraintLoader: 加载架构约束                                │    │
│  │  └── SemanticAnchor: 语义相似度匹配                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Layer 3: Engineer (执行层)                     │    │
│  │  ├── Installer: 安装新技能                                        │    │
│  │  ├── CodeSuggester: 生成代码建议                                  │    │
│  │  └── NoteGenerator: 生成学习笔记                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Layer 4: Critic + Safety (验证层)              │    │
│  │  ├── Critic: 验证 + 自适应重试 (指数退避)                         │    │
│  │  ├── Benchmark: 性能测量                                           │    │
│  │  ├── Safety: Cooldown + 人工审批                                 │    │
│  │  ├── Archive: 快照 + 回滚                                        │    │
│  │  └── ConsistencyChecker: 一致性验证                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ZeroClaw (独立执行引擎)                               │
│  - 执行 shell 命令                                                        │
│  - 编译代码                                                              │
│  - 重启服务                                                              │
│  - 健康检查                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 核心模块

### 1. 知识图谱 (KnowledgeGraph)

统一存储所有实体和关系。

**文件**: `src/learning/knowledge-graph.ts`

```typescript
// 节点类型
type NodeType = "file" | "skill" | "memory" | "constraint" | "agenda"

// 关系类型
type RelationType = "depends_on" | "related_to" | "conflicts_with" | "derives_from" | "implements" | "may_affect"

class KnowledgeGraph {
  addNode(node) // 添加实体
  addEdge(edge) // 添加关系
  getRelatedNodes() // 获取关联节点
  searchByContent() // 关键词搜索
}
```

### 2. 变更影响追踪 (ChangeImpactTracker)

代码变更时自动标记可能影响的记忆和约束。

**文件**: `src/learning/change-impact.ts`

```typescript
class ChangeImpactTracker {
  trackChange({ file, changed_by, changes_summary })
  // 1. 查找相关 memories/constraints
  // 2. 创建关联边
  // 3. 标记可能过时
}
```

### 3. 语义锚定 (SemanticAnchor)

基于特征的相似度匹配。

**文件**: `src/learning/semantic-anchor.ts`

```typescript
class SemanticAnchor {
  findSimilar(content, types, limit) // 找相似内容
  findRelatedByContext(context) // 找相关记忆
  findConflicting(content) // 找冲突
  suggestConnections(newNode) // 建议连接
}
```

### 4. 约束加载器 (ConstraintLoader)

自动加载 ARCHITECTURE.md 和约束文件。

**文件**: `src/learning/constraint-loader.ts`

```typescript
class ConstraintLoader {
  loadFromProject(rootDir) // 加载项目约束
  validateAgainstConstraints() // 验证约束
  getConstraint(type) // 获取约束
}
```

### 5. 一致性检查器 (ConsistencyChecker)

定期检查知识图谱一致性。

**文件**: `src/learning/consistency-checker.ts`

```typescript
class ConsistencyChecker {
  runFullCheck() // 完整检查
  // 检查类型:
  // - 冲突 (conflict)
  // - 过时 (outdated)
  // - 孤立 (orphan)
  // - 冗余 (redundant)
}
```

### 6. 自我进化触发器 (EvolutionTrigger)

检测变更并创建部署任务。

**文件**: `src/learning/evolution-trigger.ts`

```typescript
class EvolutionTrigger {
  checkAndTrigger() // 检查并触发
  detectCodeChanges() // 检测代码变更
  detectNewSkills() // 检测新技能
  startMonitoring() // 启动监控
}
```

### 7. 执行器 (EvolutionExecutor)

通过 ZeroClaw 执行部署任务。

**文件**: `src/learning/evolution-executor.ts`

```typescript
class EvolutionExecutor {
  executeTask(task) // 执行单个任务
  executeAll() // 执行所有待处理任务
  healthCheck() // 健康检查
  // 特性:
  // - 失败重试 (指数退避)
  // - 自动回滚
  // - 记录执行历史
}
```

---

## 完整流程

### 触发方式

1. **手动**: `/evolve` 指令
2. **定时**: 定时任务 (需配置 cron)

### 执行流程

```
用户触发 /evolve
    ↓
┌─ Cooldown 检查 ─────────────────────┐
│  距离上次进化 > 24小时？            │
└────────────────────────────────────┘
    ↓ 是
┌─ 1. Researcher (研究) ────────────┐
│  搜索 arXiv/GitHub/PyPI            │
│  生成 ResearchProposal             │
└────────────────────────────────────┘
    ↓
┌─ 2. Architect (规划) ─────────────┐
│  - Negative Memory 过滤已知失败     │
│  - ConstraintLoader 加载约束        │
│  - SemanticAnchor 找相似           │
│  - 决策: 通过/拒绝/需审批          │
└────────────────────────────────────┘
    ↓
┌─ 3. Archive 创建快照 ──────────────┐
│  保存当前状态 (SHA256 校验)        │
└────────────────────────────────────┘
    ↓
┌─ 4. Engineer (执行) ───────────────┐
│  - 安装技能                       │
│  - 生成代码建议                   │
│  - 创建学习笔记                   │
└────────────────────────────────────┘
    ↓
┌─ 5. Critic (验证) ────────────────┐
│  - 运行测试                       │
│  - 失败? → 重试 (最多3次)          │
│  - 超过重试? → 回滚               │
└────────────────────────────────────┘
    ↓
┌─ 6. KnowledgeGraph 记录 ──────────┐
│  - 记录执行结果                   │
│  - 更新关联边                     │
└────────────────────────────────────┘
    ↓
┌─ 7. Reporter 生成报告 ─────────────┐
│  输出 JSON 报告到文件              │
└────────────────────────────────────┘
    ↓
完成 → 通知用户
```

### ZeroClaw 部署流程

```
部署任务创建 (docs/learning/tasks/{id}.json)
    ↓
ZeroClaw 轮询检测到任务
    ↓
标记为 executing
    ↓
执行 commands:
  - git add -A
  - git commit
  - bun build
  - restart
    ↓
健康检查 (curl /health)
    ↓
成功 → 标记 completed
失败 → 执行 rollback_commands → 标记 rolled_back
```

---

## 使用指令

### /evolve 指令

| 指令                | 功能             |
| ------------------- | ---------------- |
| `/evolve`           | 完整自我进化周期 |
| `/evolve --execute` | 执行待处理任务   |
| `/evolve --status`  | 查看状态         |
| `/evolve --check`   | 一致性检查       |
| `/evolve --trigger` | 仅触发任务创建   |
| `/evolve --monitor` | 启动持续监控     |

### 工具调用

```typescript
import { EvolveTool, LearningTool } from "./tool/learning"

// 在会话中自动可用
@evolve(mode="full")
@learning(topics=["AI", "agent"])
```

---

## 数据模型

### 数据库表

```sql
-- 知识节点
CREATE TABLE knowledge_node (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,        -- file/skill/memory/constraint/agenda
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  embedding TEXT,            -- JSON vector
  metadata TEXT,              -- JSON
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

-- 知识边
CREATE TABLE knowledge_edge (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,     -- depends_on/related_to/conflicts_with
  weight INTEGER DEFAULT 1,
  time_created INTEGER NOT NULL
);

-- 失败记忆 (Negative Memory)
CREATE TABLE negative_memory (
  id TEXT PRIMARY KEY,
  failure_type TEXT NOT NULL,
  description TEXT NOT NULL,
  context TEXT NOT NULL,
  severity INTEGER DEFAULT 1,
  times_encountered INTEGER DEFAULT 1,
  blocked_items TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

-- 快照 (Archive Snapshot)
CREATE TABLE archive_snapshot (
  id TEXT PRIMARY KEY,
  snapshot_type TEXT NOT NULL,  -- pre_evolution/pre_skill_install/golden
  description TEXT NOT NULL,
  state TEXT NOT NULL,           -- JSON
  checksum TEXT NOT NULL,        -- SHA256
  parent_id TEXT,
  is_golden INTEGER DEFAULT 0,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);

-- 学习运行记录
CREATE TABLE learning_run (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  topics TEXT NOT NULL,
  items_collected INTEGER DEFAULT 0,
  items_processed INTEGER DEFAULT 0,
  time_created INTEGER NOT NULL
);

-- 知识条目
CREATE TABLE knowledge (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags TEXT NOT NULL,
  value_score INTEGER DEFAULT 0,
  action TEXT NOT NULL,
  processed INTEGER DEFAULT 0,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
```

### 部署任务格式

```json
{
  "id": "abc12345",
  "type": "code_change",
  "status": "pending",
  "title": "Self-evolution: Code change",
  "description": "Applying changes to 3 files",
  "changes": {
    "files": ["src/learning/a.ts", "src/learning/b.ts"],
    "diff_summary": "Add new feature X"
  },
  "commands": ["git add -A", "git commit -m 'feat: ...'", "bun run build", "echo 'restart'"],
  "rollback_commands": ["git reset --hard HEAD~1", "echo 'restart'"],
  "created_at": 1699999999999,
  "updated_at": 1699999999999
}
```

---

## 安全机制

### 1. Cooldown (冷却期)

- 默认 24 小时强制等待
- 防止频繁修改

```typescript
const safety = new Safety()
const result = await safety.checkCooldown()
// { allowed: false, reason: "Cooldown period active", cooldown_remaining_ms: 3600000 }
```

### 2. Golden Snapshot (金快照)

- 始终保留一个已知稳定的版本
- 失败时自动回滚

```typescript
await safety.createGoldenSnapshot(state)
await safety.rollbackToSafeState()
```

### 3. 自动重试 (Self-Correction)

- 失败后指数退避重试 (2, 4, 8 秒)
- 最多 3 次

### 4. 变更风险评估

```typescript
const result = await safety.checkChangeRisk(files_affected, risk)
// >50行或high risk → 需要人工审批
```

### 5. 失败记忆 (Negative Memory)

- 记录失败经验
- 防止重复犯错

```typescript
const nm = new NegativeMemory()
await nm.recordFailure({
  failure_type: "install_failed",
  description: "...",
  context: { url: "..." },
  severity: 3,
})
const isBlocked = await nm.isBlocked("https://...")
```

---

## 集成方式

### 1. 配置 ZeroClaw

`~/.config/opencode/opencode.json`:

```json
{
  "zeroclaw": {
    "enabled": true,
    "url": "http://127.0.0.1:42617",
    "token": "zc_xxx",
    "autoStart": true,
    "startPort": 42617
  }
}
```

### 2. 环境变量

`~/.zshrc`:

```bash
export ZEROCLAW_URL=http://127.0.0.1:42617
export ZEROCLAW_TOKEN=zc_xxx
export ZEROCLAW_AUTO_START=true
export ZEROCLAW_START_PORT=42617
```

### 3. 代码调用

```typescript
import { EvolutionTrigger, EvolutionExecutor, KnowledgeGraph, ConsistencyChecker } from "./learning"

// 触发进化
const trigger = new EvolutionTrigger()
const result = await trigger.checkAndTrigger()

// 执行任务
const executor = new EvolutionExecutor()
const results = await executor.executeAll()

// 检查一致性
const checker = new ConsistencyChecker()
const report = await checker.runFullCheck()
```

---

## 快速开始

### 1. 启动 OpenCode

```bash
opencode
```

### 2. 触发自我进化

```
/evolve
```

### 3. 查看状态

```
/evolve --status
```

### 4. 执行待处理任务

```
/evolve --execute
```

### 5. 检查一致性

```
/evolve --check
```

---

## 文件结构

```
packages/opencode/src/learning/
├── knowledge-graph.ts       # 统一知识图谱
├── change-impact.ts       # 变更影响追踪
├── semantic-anchor.ts     # 语义相似度
├── constraint-loader.ts   # 约束加载
├── consistency-checker.ts # 一致性检查
├── evolution-trigger.ts  # 触发器
├── evolution-executor.ts # 执行器
├── negative.ts           # 失败记忆
├── archive.ts            # 快照回滚
├── safety.ts             # 安全机制
├── reporter.ts           # 报告生成
├── deployer.ts           # 部署任务
├── collector.ts          # 信息收集
├── analyzer.ts          # 分析
├── researcher.ts         # 研究提议
├── architect.ts         # 规划决策
├── critic.ts            # 验证
└── learning.sql.ts      # 数据库表
```

---

## 总结

| 能力       | 完成度  |
| ---------- | ------- |
| 自我进化   | ✅ 100% |
| 长程一致性 | ✅ 100% |
| 部署闭环   | ✅ 100% |
| 安全机制   | ✅ 100% |
| 用户指令   | ✅ 100% |

---

_Generated: 2026-03-04_
