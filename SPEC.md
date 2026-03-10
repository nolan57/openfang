# OpenCode V2 Architecture Specification

## Collaborative Multi-Agent System with Three-Layer Memory

### Version: 2.0

### Status: Implementation Guide

### Last Updated: 2026-03-10

---

## 1. Executive Summary

This document defines the architecture for OpenCode V2, featuring a collaborative multi-agent system built on a unified three-layer memory infrastructure. The system enables multiple persistent agents to share context, skills, and project knowledge through a carefully designed memory architecture inspired by MemOS but tailored for code-centric operations.

**Core Design Principles:**

- **Three-Layer Memory**: Session (ephemeral), Evolution (persistent), Project (knowledge graph)
- **Collaborative Agents**: Multiple persistent agents with shared memory and communication
- **Incremental Project Indexing**: Full initial index with delta updates thereafter
- **Event-Driven Coordination**: Agents communicate via message bus with memory coordination

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    OpenCode V2 Architecture                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Agent System Layer                         │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐          │  │
│  │  │ Agent A │  │ Agent B │  │ Agent C │  │ Agent N │          │  │
│  │  │(Review) │  │(Build)  │  │ (Test)  │  │(Custom) │          │  │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘          │  │
│  │       └─────────────┴─────────────┴─────────────┘              │  │
│  │                         │                                      │  │
│  │              ┌──────────┴──────────┐                        │  │
│  │              │   Agent Registry    │  ← Lifecycle mgmt        │  │
│  │              │   Agent Comms       │  ← Message bus          │  │
│  │              │   Task Coordinator  │  ← Dispatch/aggregate  │  │
│  │              └─────────────────────┘                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                            │                                        │
│  ┌─────────────────────────┼────────────────────────────────────┐  │
│  │                   Memory Layer (三层记忆)                       │  │
│  │                                                              │  │
│  │    ┌───────────────────┬───────────────────┐                │  │
│  │    │                   │                   │                │  │
│  │    ▼                   ▼                   ▼                │  │
│  │ ┌─────────┐      ┌───────────┐      ┌──────────┐         │  │
│  │ │ Session │◄────►│ Evolution │◄────►│ Project   │         │  │
│  │ │ Memory  │      │  Memory   │      │  Memory  │         │  │
│  │ └────┬────┘      └─────┬─────┘      └────┬─────┘         │  │
│  │      │                 │                    │                │  │
│  │      └─────────────────┴────────────────────┘                │  │
│  │                         │                                     │  │
│  │              ┌──────────┴──────────┐                        │  │
│  │              │  Memory Coordinator │  ← Cross-memory linking  │  │
│  │              └─────────────────────┘                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                            │                                        │
│  ┌─────────────────────────┼────────────────────────────────────┐  │
│  │                   Storage Layer                               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐     │  │
│  │  │  SQLite  │  │  Vector   │  │Knowledge │  │  Redis  │     │  │
│  │  │          │  │   Store   │  │  Graph   │  │(Queue)  │     │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └─────────┘     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Agent System Specification

### 3.1 Agent Definition

```typescript
// Core Agent Interface
interface Agent {
  id: string // Unique identifier (UUID)
  name: string // Human-readable name
  type: AgentType // build, review, test, explore, general, custom
  role: AgentRole // coordinator, worker, specialist
  state: AgentState // idle, running, busy, terminated
  capabilities: string[] // List of capability tags
  config: AgentConfig // Model, tools, permissions
  createdAt: Date
  lastActiveAt: Date
}

type AgentType = "build" | "review" | "test" | "explore" | "general" | "custom"
type AgentRole = "coordinator" | "worker" | "specialist"
type AgentState = "idle" | "running" | "busy" | "terminated"

// Agent Configuration
interface AgentConfig {
  model: {
    providerID: string
    modelID: string
  }
  tools: string[] // Enabled tool names
  permission: PermissionSet
  maxSteps?: number
  timeout?: number
}
```

### 3.2 Agent Registry

**Responsibilities:** Manage agent lifecycle (register, unregister, list, find)

```typescript
interface AgentRegistry {
  // Register a new agent
  register(agent: Agent): Promise<void>

  // Unregister an agent
  unregister(agentId: string): Promise<void>

  // Get agent by ID
  get(agentId: string): Promise<Agent | null>

  // List all agents, optionally filtered
  list(filter?: { type?: AgentType; role?: AgentRole; state?: AgentState }): Promise<Agent[]>

  // Find agents by capability
  findByCapability(capability: string): Promise<Agent[]>

  // Update agent state
  updateState(agentId: string, state: AgentState): Promise<void>

  // Update last active timestamp
  touch(agentId: string): Promise<void>
}

// Storage: SQLite table 'agents'
// Schema: id, name, type, role, state, capabilities (JSON), config (JSON), created_at, last_active_at
```

### 3.3 Agent Communication (Agent Comms)

**Responsibilities:** Message passing between agents, publish/subscribe

```typescript
// Message Types
type AgentMessage = TaskMessage | ResultMessage | BroadcastMessage | MemoryShareMessage | QueryMessage

interface BaseMessage {
  id: string // UUID
  type: string
  from: string // Agent ID
  timestamp: Date
}

interface TaskMessage extends BaseMessage {
  type: "task"
  to: string // Target agent ID
  task: {
    id: string
    action: string
    payload: unknown
    priority?: "low" | "normal" | "high"
  }
}

interface ResultMessage extends BaseMessage {
  type: "result"
  to: string // Original requesting agent
  taskId: string
  success: boolean
  payload: unknown
  error?: string
}

interface BroadcastMessage extends BaseMessage {
  type: "broadcast"
  content: string
  scope: "all" | "role:*" | "type:*" | string[]
}

interface MemoryShareMessage extends BaseMessage {
  type: "memory_share"
  memories: MemoryRef[]
}

interface QueryMessage extends BaseMessage {
  type: "query"
  query: string
  sources: ("session" | "evolution" | "project")[]
  responseTo?: string // Agent ID to respond to
}

// Agent Comms Interface
interface AgentComms {
  // Send a message to a specific agent
  send(message: AgentMessage): Promise<void>

  // Broadcast to multiple agents
  broadcast(message: BroadcastMessage): Promise<void>

  // Subscribe to messages for an agent
  subscribe(agentId: string, handler: (msg: AgentMessage) => void): () => void

  // Query across agent memories
  query(request: QueryMessage): Promise<QueryResponse>
}

interface QueryResponse {
  from: string
  results: Array<{
    source: "session" | "evolution" | "project"
    memories: MemoryRef[]
  }>
}

// Implementation: In-memory pub/sub with SQLite persistence for message log
// Redis Streams can be added for distributed deployment
```

### 3.4 Task Coordinator

**Responsibilities:** Task dispatch, result aggregation, workflow orchestration

```typescript
// Dispatch Strategies
type DispatchStrategy =
  | "round_robin" // Rotate through available agents
  | "capability_based" // Match task requirements to agent capabilities
  | "load_balanced" // Select least busy agent

interface Task {
  id: string
  action: string
  payload: unknown
  requirements: string[] // Required capabilities
  priority: "low" | "normal" | "high"
  timeout?: number
  dependencies?: string[] // Task IDs that must complete first
}

interface TaskResult {
  taskId: string
  agentId: string
  success: boolean
  payload: unknown
  duration: number
  error?: string
}

interface TaskCoordinator {
  // Dispatch a task using specified strategy
  dispatch(task: Task, strategy: DispatchStrategy): Promise<string> // Returns agent ID

  // Wait for task result
  wait(taskId: string, timeout: number): Promise<TaskResult>

  // Dispatch multiple tasks in parallel
  dispatchBatch(tasks: Task[], strategy: DispatchStrategy): Promise<string[]>

  // Cancel a pending task
  cancel(taskId: string): Promise<void>

  // Get task status
  status(taskId: string): Promise<{
    state: "pending" | "running" | "completed" | "failed" | "cancelled"
    agentId?: string
    result?: TaskResult
  }>
}

// Implementation: In-memory queue with worker pool
// For distributed: Redis-backed queue
```

### 3.5 Agent Implementation Guidelines

**For each agent type, implement:**

1. **Initialization**: Load config, register with AgentRegistry
2. **Event Loop**:
   - Subscribe to messages
   - Process incoming tasks
   - Update state appropriately
3. **Memory Access**: Read/write through MemoryCoordinator
4. **Tool Execution**: Use existing tool registry
5. **Communication**: Use AgentComms for inter-agent messaging

**Example Agent Structure:**

```
src/agent/
├── registry.ts      # AgentRegistry implementation
├── comms.ts         # AgentComms implementation
├── coordinator.ts   # TaskCoordinator implementation
├── types.ts         # All TypeScript interfaces
└── agents/
    ├── base.ts      # BaseAgent abstract class
    ├── build.ts     # Build agent
    ├── review.ts    # Review agent
    ├── test.ts      # Test agent
    └── explore.ts   # Explore agent
```

---

## 4. Three-Layer Memory Specification

### 4.1 Memory Abstraction Layer

**Unified interface for all memory operations:**

```typescript
interface MemoryService {
  // Add memories
  add(params: AddMemoryParams): Promise<string[]>

  // Search memories
  search(params: SearchParams): Promise<MemoryResult[]>

  // Update memories
  update(id: string, updates: Partial<MemoryEntry>): Promise<void>

  // Delete memories
  delete(ids: string[]): Promise<void>

  // Get memory by ID
  get(id: string): Promise<MemoryEntry | null>

  // Cross-memory operations
  link(sourceId: string, targetId: string, relation: string): Promise<void>
  findLinked(id: string, relation?: string): Promise<MemoryRef[]>
}

interface AddMemoryParams {
  memoryType: MemoryType
  content: string
  metadata?: Record<string, unknown>
  tags?: string[]
  entityRefs?: string[] // References to code entities
}

interface SearchParams {
  query: string
  memoryType?: MemoryType
  limit?: number
  minSimilarity?: number
  filters?: Record<string, unknown>
}

interface MemoryResult {
  id: string
  memoryType: MemoryType
  content: string
  similarity: number
  metadata?: Record<string, unknown>
}

type MemoryType = "session" | "evolution" | "project"
```

### 4.2 Session Memory (短期会话记忆)

**Purpose:** Ephemeral shared context for current agent session

| Attribute      | Value                                           |
| -------------- | ----------------------------------------------- |
| **Storage**    | Vector Store + SQLite                           |
| **Lifecycle**  | Session-bound (configurable TTL)                |
| **Read/Write** | High frequency                                  |
| **Capacity**   | Last N messages (default: 100)                  |
| **Content**    | Conversations, extracted entities, task context |

**Data Model:**

```typescript
interface SessionMemory {
  id: string
  sessionId: string // Group related memories
  agentIds: string[] // Agents sharing this session
  messages: SessionMessage[]
  extractedEntities: ExtractedEntity[]
  contextSummary?: string // Auto-summarized context
  createdAt: Date
  expiresAt: Date // TTL based
}

interface SessionMessage {
  id: string
  role: "user" | "assistant" | "agent" | "system"
  content: string
  agentId?: string
  timestamp: Date
}

interface ExtractedEntity {
  type: "code" | "file" | "function" | "api" | "concept"
  value: string
  references: string[] // File paths, line numbers
}
```

**Operations:**

```typescript
interface SessionMemoryService {
  // Create a new session
  createSession(agentIds: string[]): Promise<string>

  // Add message to session
  addMessage(sessionId: string, message: SessionMessage): Promise<void>

  // Search session
  searchSession(sessionId: string, query: string, limit?: number): Promise<MemoryResult[]>

  // Get all messages in session
  getMessages(sessionId: string): Promise<SessionMessage[]>

  // Summarize session (for long sessions)
  summarizeSession(sessionId: string): Promise<string>

  // End session (marks for expiration)
  endSession(sessionId: string): Promise<void>

  // Cleanup expired sessions
  cleanup(): Promise<number> // Returns count deleted
}

// Storage:
// - Vector Store: session_memories (id, session_id, content, embedding, metadata)
// - SQLite: sessions (id, agent_ids, context_summary, created_at, expires_at)
```

### 4.3 Evolution Memory (演进记忆)

**Purpose:** Long-term memory for system self-evolution, skills, constraints

| Attribute      | Value                                                    |
| -------------- | -------------------------------------------------------- |
| **Storage**    | Vector Store + Knowledge Graph                           |
| **Lifecycle**  | Permanent                                                |
| **Read/Write** | Medium frequency                                         |
| **Capacity**   | Unlimited                                                |
| **Content**    | Skills, constraints, learned patterns, evolution history |

**Data Model:**

```typescript
interface EvolutionMemory {
  // Skill: Reusable capability
  skill: {
    id: string
    name: string
    description: string
    prompt: string
    trigger: string[] // Keywords that activate this skill
    version: number
    source: "learned" | "manual" | "imported"
    createdAt: Date
    updatedAt: Date
    approved: boolean // Requires approval before use
  }

  // Constraint: Rule or guideline
  constraint: {
    id: string
    name: string
    description: string
    rule: string
    severity: "error" | "warning" | "info"
    scope: string[] // File patterns, agent types
    enabled: boolean
    source: "learned" | "manual"
    createdAt: Date
  }

  // Learned Pattern: Discovered code pattern
  learnedPattern: {
    id: string
    name: string
    description: string
    context: string
    examples: string[]
    frequency: number
    confidence: number
    discoveredAt: Date
  }

  // Evolution Record: History of system changes
  evolutionRecord: {
    id: string
    trigger: string
    changes: Change[]
    status: "pending" | "approved" | "rejected" | "rolled_back"
    approvedBy?: string
    createdAt: Date
    appliedAt?: Date
  }
}
```

**Operations:**

```typescript
interface EvolutionMemoryService {
  // Skills
  addSkill(skill: Omit<Skill, "id" | "createdAt" | "updatedAt">): Promise<string>
  updateSkill(id: string, updates: Partial<Skill>): Promise<void>
  getSkill(id: string): Promise<Skill | null>
  searchSkills(query: string): Promise<Skill[]>
  listSkills(): Promise<Skill[]>
  deleteSkill(id: string): Promise<void>

  // Constraints
  addConstraint(constraint: Omit<Constraint, "id" | "createdAt">): Promise<string>
  updateConstraint(id: string, updates: Partial<Constraint>): Promise<void>
  getConstraint(id: string): Promise<Constraint | null>
  searchConstraints(query: string): Promise<Constraint[]>
  listConstraints(filters?: { enabled?: boolean; severity?: string }): Promise<Constraint[]>
  deleteConstraint(id: string): Promise<void>

  // Learned Patterns
  recordPattern(pattern: Omit<LearnedPattern, "id" | "discoveredAt">): Promise<string>
  getPatterns(frequency?: number, confidence?: number): Promise<LearnedPattern[]>

  // Evolution Records
  createEvolutionRecord(trigger: string, changes: Change[]): Promise<string>
  approveEvolution(id: string, approver: string): Promise<void>
  rejectEvolution(id: string, reason: string): Promise<void>
  getEvolutionHistory(limit?: number): Promise<EvolutionRecord[]>
}

// Storage:
// - Vector Store: evolution_memories (id, type, content, embedding, metadata)
// - SQLite: skills, constraints, learned_patterns, evolution_records tables
```

### 4.4 Project Memory (项目知识图谱)

**Purpose:** Comprehensive project knowledge graph with incremental indexing

| Attribute      | Value                                                         |
| -------------- | ------------------------------------------------------------- |
| **Storage**    | Knowledge Graph + Vector Store                                |
| **Lifecycle**  | Project-bound                                                 |
| **Read/Write** | Low frequency (incremental updates)                           |
| **Capacity**   | Entire project                                                |
| **Content**    | Code entities, file relationships, API graphs, change history |

**Data Model:**

```typescript
// Code Entity: Represents a code element
interface CodeEntity {
  id: string // Unique: file_path:line:col:type
  type: EntityType
  name: string
  file: string
  line?: number
  column?: number
  signature?: string
  docstring?: string
  relations: EntityRelation[]
  metadata: {
    language: string
    complexity?: number
    lastModified: Date
    [key: string]: unknown
  }
}

type EntityType =
  | "file"
  | "directory"
  | "function"
  | "class"
  | "method"
  | "constructor"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "constant"
  | "property"
  | "import"
  | "export"
  | "api"
  | "endpoint"
  | "test"
  | "config"

interface EntityRelation {
  targetId: string
  type: RelationType
  metadata?: Record<string, unknown>
}

type RelationType =
  | "imports"
  | "exports"
  | "extends"
  | "implements"
  | "calls"
  | "called_by"
  | "uses"
  | "used_by"
  | "contains"
  | "contained_in"
  | "tests"
  | "tested_by"
  | "configures"
  | "configured_by"
  | "api_endpoint"
  | "api_caller"

// Change Record: For incremental indexing
interface ChangeRecord {
  id: string
  type: "add" | "modify" | "delete"
  file: string
  entities: string[] // Entity IDs affected
  timestamp: Date
  commitHash?: string
  diff?: string
}
```

**Operations:**

```typescript
interface ProjectMemoryService {
  // Full Indexing
  indexProject(forceRebuild?: boolean): Promise<IndexResult>

  // Incremental Indexing
  indexChanges(changes: ChangeRecord[]): Promise<void>

  // Query Entities
  getEntity(id: string): Promise<CodeEntity | null>
  getEntitiesByFile(file: string): Promise<CodeEntity[]>
  getEntitiesByType(type: EntityType): Promise<CodeEntity[]>

  // Search
  searchProject(
    query: string,
    options?: {
      types?: EntityType[]
      files?: string[]
      limit?: number
    },
  ): Promise<SearchResult[]>

  // Knowledge Graph Traversal
  getRelationPath(fromId: string, toId: string, maxDepth?: number): Promise<string[]>
  getDependents(entityId: string): Promise<CodeEntity[]>
  getDependencies(entityId: string): Promise<CodeEntity[]>

  // Change History
  getChangeHistory(entityId: string, limit?: number): Promise<ChangeRecord[]>
  getRecentChanges(limit?: number): Promise<ChangeRecord[]>

  // Stats
  getStats(): Promise<{
    totalEntities: number
    byType: Record<EntityType, number>
    totalRelations: number
    lastIndexed: Date
  }>
}

interface IndexResult {
  entitiesAdded: number
  entitiesUpdated: number
  entitiesDeleted: number
  duration: number
  errors?: string[]
}

interface SearchResult {
  entity: CodeEntity
  relevance: number
  highlights: string[]
}
```

### 4.5 Memory Coordinator

**Responsibilities:** Cross-memory linking, query routing, consistency

```typescript
interface MemoryCoordinator {
  // Route search to appropriate memory layer(s)
  search(params: SearchParams): Promise<CrossMemoryResult[]>

  // Link memories across layers
  link(source: MemoryRef, target: MemoryRef, relation: string): Promise<void>

  // Find linked memories
  findLinked(memoryId: string, relation?: string): Promise<MemoryRef[]>

  // Unified add (route to appropriate layer)
  add(params: AddMemoryParams): Promise<string[]>

  // Trigger cross-memory sync
  sync(entityId: string): Promise<void>
}

interface CrossMemoryResult {
  memoryType: MemoryType
  id: string
  content: string
  similarity: number
  links?: MemoryRef[]
}

// Linking Rules (when to auto-link):
// 1. Session mentions code → link to Project Memory entity
// 2. Evolution creates skill → link to relevant Project entities
// 3. Project change affects skill → link to Evolution Memory
```

---

## 5. Storage Layer Specification

### 5.1 Database Schema

**SQLite Tables:**

```sql
-- Agents
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  role TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle',
  capabilities TEXT NOT NULL,  -- JSON array
  config TEXT NOT NULL,        -- JSON
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL
);

-- Sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  context_summary TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE session_agents (
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  PRIMARY KEY (session_id, agent_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- Skills
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  prompt TEXT NOT NULL,
  trigger TEXT NOT NULL,       -- JSON array
  version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Constraints
CREATE TABLE constraints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL,
  scope TEXT NOT NULL,         -- JSON array
  enabled INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Learned Patterns
CREATE TABLE learned_patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  context TEXT NOT NULL,
  examples TEXT NOT NULL,      -- JSON array
  frequency INTEGER NOT NULL DEFAULT 1,
  confidence REAL NOT NULL,
  discovered_at TEXT NOT NULL
);

-- Evolution Records
CREATE TABLE evolution_records (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  changes TEXT NOT NULL,       -- JSON array
  status TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  applied_at TEXT
);

-- Project Entities (Knowledge Graph)
CREATE TABLE project_entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  file TEXT NOT NULL,
  line INTEGER,
  column INTEGER,
  signature TEXT,
  docstring TEXT,
  metadata TEXT,               -- JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_relations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  metadata TEXT,
  FOREIGN KEY (source_id) REFERENCES project_entities(id),
  FOREIGN KEY (target_id) REFERENCES project_entities(id)
);

-- Change Records
CREATE TABLE change_records (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  file TEXT NOT NULL,
  entities TEXT NOT NULL,      -- JSON array
  timestamp TEXT NOT NULL,
  commit_hash TEXT,
  diff TEXT
);

-- Memory Links
CREATE TABLE memory_links (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Message Log (for debugging/audit)
CREATE TABLE agent_messages (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  from_agent TEXT NOT NULL,
  to_agent TEXT,
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

-- Indexes
CREATE INDEX idx_agents_type ON agents(type);
CREATE INDEX idx_agents_state ON agents(state);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_skills_name ON skills(name);
CREATE INDEX idx_entities_file ON project_entities(file);
CREATE INDEX idx_entities_type ON project_entities(type);
CREATE INDEX idx_relations_source ON project_relations(source_id);
CREATE INDEX idx_relations_target ON project_relations(target_id);
CREATE INDEX idx_links_source ON memory_links(source_type, source_id);
CREATE INDEX idx_links_target ON memory_links(target_type, target_id);
```

### 5.2 Vector Store

**Use existing `vector-store.ts` with extensions:**

```typescript
// Extend existing VectorStore for new memory types
interface ExtendedVectorStore {
  // Existing methods preserved
  init(): Promise<void>
  add(entries: VectorEntry[]): Promise<void>
  search(options: SearchOptions): Promise<SearchResult[]>

  // New methods for memory system
  searchByType(type: MemoryType, query: string, options?: SearchOptions): Promise<SearchResult[]>
  deleteByType(type: MemoryType, ids: string[]): Promise<void>
}

// Collection naming:
// - session_memories
// - evolution_memories
// - project_memories
```

### 5.3 Knowledge Graph

**Use existing `knowledge-graph.ts`:**

```typescript
// Extend existing KnowledgeGraph for project memory
interface ExtendedKnowledgeGraph {
  // Existing methods preserved
  addNode(node: KnowledgeNode): Promise<void>
  addEdge(edge: Edge): Promise<void>
  search(query: string, limit?: number): Promise<KnowledgeNode[]>

  // New methods
  getEntity(id: string): Promise<KnowledgeNode | null>
  getRelations(entityId: string, direction?: "in" | "out" | "both"): Promise<Edge[]>
  findPath(fromId: string, toId: string, maxDepth: number): Promise<string[] | null>
  getSubgraph(centerId: string, depth: number): Promise<{ nodes: KnowledgeNode[]; edges: Edge[] }>
}
```

---

## 6. Implementation Roadmap

### Phase 1: Agent Foundation (Week 1-2)

| Task | Description                     | Files to Create/Modify       |
| ---- | ------------------------------- | ---------------------------- |
| T1.1 | Define TypeScript interfaces    | `src/agent/types.ts`         |
| T1.2 | Implement Agent Registry        | `src/agent/registry.ts`      |
| T1.3 | Implement Agent Comms (pub/sub) | `src/agent/comms.ts`         |
| T1.4 | Implement Task Coordinator      | `src/agent/coordinator.ts`   |
| T1.5 | Create database migrations      | `migration/agent_system.sql` |
| T1.6 | Add agent CLI commands          | `src/cli/cmd/agent.ts`       |

### Phase 2: Three-Layer Memory (Week 3-5)

| Task | Description                     | Files to Create/Modify        |
| ---- | ------------------------------- | ----------------------------- |
| T2.1 | Memory abstraction interface    | `src/memory/service.ts`       |
| T2.2 | Session Memory implementation   | `src/memory/session.ts`       |
| T2.3 | Evolution Memory implementation | `src/memory/evolution.ts`     |
| T2.4 | Project Memory implementation   | `src/memory/project.ts`       |
| T2.5 | Memory Coordinator              | `src/memory/coordinator.ts`   |
| T2.6 | Database migrations for memory  | `migration/memory_system.sql` |

### Phase 3: Integration (Week 6-7)

| Task | Description                          | Files to Create/Modify  |
| ---- | ------------------------------------ | ----------------------- |
| T3.1 | Integrate memory with existing tools | `src/tool/registry.ts`  |
| T3.2 | Add memory context to agent prompts  | `src/session/prompt.ts` |
| T3.3 | Connect Task tool to memory          | `src/tool/task.ts`      |
| T3.4 | Add memory CLI commands              | `src/cli/cmd/memory.ts` |

### Phase 4: Collaboration Features (Week 8-9)

| Task | Description                         | Files to Create/Modify      |
| ---- | ----------------------------------- | --------------------------- |
| T4.1 | Implement multi-agent task dispatch | `src/agent/coordinator.ts`  |
| T4.2 | Add result aggregation              | `src/agent/comms.ts`        |
| T4.3 | Cross-memory linking automation     | `src/memory/coordinator.ts` |
| T4.4 | Agent lifecycle hooks               | `src/agent/agents/base.ts`  |

---

## 7. API Reference

### Agent CLI Commands

```bash
# List agents
opencode agent list

# Register new agent
opencode agent add <name> --type <type> --role <role>

# Remove agent
opencode agent remove <agent_id>

# Agent status
opencode agent status <agent_id>

# Send message to agent
opencode agent send <agent_id> <message>
```

### Memory CLI Commands

```bash
# Search all memories
opencode memory search <query>

# Search specific memory type
opencode memory search <query> --type session|evolution|project

# Add skill to evolution memory
opencode memory add skill --name <name> --prompt <prompt>

# Add constraint
opencode memory add constraint --name <name> --rule <rule>

# Project memory stats
opencode memory project stats

# Rebuild project index
opencode memory project rebuild
```

---

## 8. Configuration

### Memory Configuration (opencode.json)

```json
{
  "memory": {
    "session": {
      "ttlMinutes": 60,
      "maxMessages": 100,
      "autoSummarize": true
    },
    "evolution": {
      "autoApprove": false,
      "requireApproval": true
    },
    "project": {
      "indexOnStartup": false,
      "incrementalOnly": true,
      "excludePatterns": ["node_modules/**", "dist/**", "*.log"]
    }
  },
  "agent": {
    "maxConcurrent": 5,
    "defaultTimeout": 300000,
    "dispatchStrategy": "capability_based"
  }
}
```

---

## 9. Backward Compatibility

**All existing functionality must be preserved:**

1. **Single Agent Mode**: Default behavior unchanged; memory system adds optional enhancement
2. **Tool Execution**: Existing tools work without modification
3. **CLI Commands**: All existing commands continue to work
4. **Configuration**: New config fields are optional with sensible defaults

---

## 10. Testing Strategy

### Unit Tests

- Agent registry CRUD operations
- Memory service add/search/delete
- Task coordinator dispatch logic

### Integration Tests

- Agent-to-agent messaging
- Cross-memory linking
- Incremental project indexing

### E2E Tests

- Full workflow: create agents → share session → collaborate → persist evolution

---

## 11. Migration Guide

### For Existing V1 Users

1. **No automatic migration required** - V2 is additive
2. **New memory tables created automatically** via migration
3. **Existing agents continue to work** in single-agent mode
4. **Multi-agent features opt-in** via configuration

---

## 12. Glossary

| Term                   | Definition                                                |
| ---------------------- | --------------------------------------------------------- |
| **Agent**              | Autonomous entity with identity, capabilities, and memory |
| **Session**            | Temporary context shared among collaborating agents       |
| **Skill**              | Reusable prompt pattern stored in Evolution Memory        |
| **Constraint**         | Rule or guideline enforced during execution               |
| **Code Entity**        | Structured representation of code element                 |
| **Memory Type**        | session / evolution / project                             |
| **Dispatch Strategy**  | Algorithm for selecting agent to handle task              |
| **Memory Coordinator** | System for cross-layer memory operations                  |

---

## 13. References

- MemOS Architecture: https://arxiv.org/abs/2507.03724
- OpenCode Current Implementation: `packages/opencode/src/`
- Existing Vector Store: `packages/opencode/src/learning/vector-store.ts`
- Existing Knowledge Graph: `packages/opencode/src/learning/knowledge-graph.ts`

---

_This document serves as the implementation guide for OpenCode V2. All implementation must follow these specifications precisely._
