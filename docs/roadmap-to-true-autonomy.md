# Roadmap: Achieving True LRC and Self-Evolution

This document outlines a comprehensive plan to bridge the gap from current capabilities (72/58) to true autonomous self-evolving system (90+).

---

## Executive Summary

| Capability     | Current State      | Target State                        | Gap Level |
| -------------- | ------------------ | ----------------------------------- | --------- |
| Memory Search  | 🔤 Keyword Match   | 🧠 Semantic Vector Search           | 🔴 High   |
| Evolution Type | 📝 Notebook Growth | 🧬 DNA Mutation (Self-Modification) | 🔴 High   |
| Verification   | 👤 Human Approval  | 🤖 Auto-Critic + Sandbox            | 🟡 Medium |
| Architecture   | 📂 JSON Files      | 🗄️ Vector DB + Knowledge Graph      | 🟡 Medium |

---

## Phase 1: Memory System Upgrade (Weeks 1-3)

### 1.1 Integrate Vector Search into Memory System

**Current State**: Memory uses keyword matching in `src/evolution/memory.ts`
**Target State**: Memory uses sqlite-vec vector search

**Actions Required**:

```
┌─────────────────────────────────────────────────────────────────┐
│  Integration Architecture                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Memory Creation                                                │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│  │  evolution  │────▶│  VectorStore     │────▶│  sqlite-vec │ │
│  │  memory.ts  │     │  (embedAndStore) │     │  virtual    │ │
│  └─────────────┘     └──────────────────┘     │  table      │ │
│                                                └─────────────┘ │
│                                                                  │
│  Memory Retrieval                                               │
│       │                                                          │
│       ▼                                                          │
│  ┌─────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│  │  getRel     │────▶│  VectorStore     │────▶│  Hybrid     │ │
│  │  evant      │     │  (search)        │     │  Search     │ │
│  │  Memories   │◀────│                  │◀────│  + MMR       │ │
│  └─────────────┘     └──────────────────┘     └─────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Specific Changes**:

1. Modify `src/evolution/memory.ts` to call `VectorStore.embedAndStore()` when creating memories
2. Replace `getRelevantMemories()` to use `VectorStore.search()`
3. Implement Hybrid Search: Vector Similarity + Keyword BM25
4. Add MMR (Maximal Marginal Relevance) re-ranking

### 1.2 Add Temporal Decay

**Implementation**:

- Add `lastAccessedAt` timestamp to memory entries
- Apply exponential decay: `score = relevance * e^(-λ * age)`
- Implement forgetting curve: memories accessed less frequently over time get lower priority

### 1.3 Migrate to SQLite Storage

**Current**: JSON files in `.opencode/evolution/memories-YYYY-MM.json`
**Target**: SQLite with vector columns

**Benefits**:

- Atomic transactions
- Better query performance
- Native vector storage integration

---

## Phase 2: Self-Modification Capability (Weeks 4-6)

### 2.1 Activate SelfRefactor Integration

**Current State**: `SelfRefactor` class exists but is never called
**Target State**: Autonomous code self-improvement

**Activation Plan**:

```
┌──────────────────────────────────────────────────────────────────┐
│  Self-Refactor Workflow                                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. Scheduled Trigger (e.g., every N sessions)                  │
│         │                                                        │
│         ▼                                                        │
│  2. SelfRefactor.scanForIssues()                                │
│         │                                                        │
│         ├─── unused_import ──▶ Auto-fix + Commit                 │
│         ├─── console_log ───▶ Auto-fix + Commit                  │
│         ├─── type_any ───────▶ Log for human review              │
│         └─── complexity ─────▶ Log for human review              │
│                                                                   │
│  3. createPullRequest()                                          │
│         │                                                        │
│         ▼                                                        │
│  4. Self code updated!                                           │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

**Safety Mechanisms**:

- Whitelist of fixable issues (unused_import, console_log)
- Human-reviewed issues (type_any, complexity) - log only
- Git branch isolation before changes
- Automatic rollback on CI failure

### 2.2 Architecture-Constrained Self-Access

**Current**: Agent cannot modify its own source
**Target**: Controlled self-modification

**Implementation**:

1. Create `constraints/architecture.md` - defines what CAN be modified
2. Grant read access to `src/` directory
3. Use constraint loader (`src/learning/constraint-loader.ts`) to validate changes
4. All self-modifications require PR approval (never auto-merge)

---

## Phase 3: Automated Verification (Weeks 7-8)

### 3.1 Skill Sandbox Testing

**Current**: Skills require manual `approve` command
**Target**: Automated testing pipeline

```
┌──────────────────────────────────────────────────────────────────┐
│  Automated Skill Verification                                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Proposed Skill                                                   │
│       │                                                           │
│       ▼                                                           │
│  ┌─────────────────┐                                             │
│  │ Syntax Validation│                                             │
│  └────────┬────────┘                                             │
│           │ OK                                                    │
│           ▼                                                       │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │ Sandbox Execute │────▶│  Test Cases     │                   │
│  │ (isolated env)  │     │  (auto-generated│                   │
│  └────────┬────────┘     │   or provided)  │                   │
│           │               └─────────────────┘                   │
│           ▼                                                       │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │  Results        │────▶│  Approval       │                   │
│  │  - PASS         │     │  - Auto-approved│                   │
│  │  - FAIL         │     │  - Human review │                   │
│  │  - TIMEOUT      │     │                   │                   │
│  └─────────────────┘     └─────────────────┘                   │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

**Sandbox Options**:

1. **Docker container**: Full isolation, heavier
2. **Landlock**: Linux kernel sandbox (already supported in zeroclaw)
3. **VM**: Maximum isolation, slowest

### 3.2 Self-Refactor Verification

**Pipeline**:

1. Apply proposed fixes to test branch
2. Run `bun typecheck`
3. Run `bun test`
4. Check for performance regressions (benchmarks)
5. Generate diff report
6. Only create PR if all checks pass

---

## Phase 4: Knowledge Graph Integration (Weeks 9-10)

### 4.1 Build Knowledge Graph

**Current**: Flat memory entries
**Target**: Rich knowledge graph with entities and relationships

```
┌──────────────────────────────────────────────────────────────────┐
│  Knowledge Graph Architecture                                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────┐    relates_to    ┌─────────┐                       │
│  │ Memory  │──────────────────│ Memory  │                       │
│  │ Node A  │                  │ Node B  │                       │
│  └────┬────┘                  └────┬────┘                       │
│       │                            │                             │
│       │ derives_from               │ implies                     │
│       ▼                            ▼                             │
│  ┌─────────────────┐        ┌─────────────────┐                 │
│  │ Constraint     │        │ Pattern         │                 │
│  │ Node           │        │ Node            │                 │
│  └─────────────────┘        └─────────────────┘                 │
│                                                                   │
│  Query: "How does this pattern relate to architecture rules?"    │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

**Implementation**:

1. Use existing `knowledge_nodes` and `knowledge_edges` tables
2. Add entity extraction (NER) for memory entries
3. Build relationship inference engine
4. Enable graph-based reasoning

### 4.2 Consistency Checker Enhancement

**Current**: Basic consistency checks in `src/learning/consistency-checker.ts`
**Target**: Full autonomous consistency verification

**Features**:

- Cross-reference memory with constraints
- Detect conflicting patterns
- Propose resolutions

---

## Phase 5: Model Integration (Weeks 11-12)

### 5.1 LoRA Fine-Tuning Pipeline

**Current**: Static model weights
**Target**: Adaptive model through LoRA

```
┌──────────────────────────────────────────────────────────────────┐
│  LoRA Fine-Tuning Pipeline                                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Experience Collection                                           │
│       │                                                           │
│       ▼                                                           │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Extract training examples from successful sessions        │ │
│  │  - Tool usage patterns                                      │ │
│  │  - Error recovery strategies                               │ │
│  │  - Effective prompts                                       │ │
│  └────────────────────────────┬────────────────────────────────┘ │
│                               │                                    │
│                               ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Generate LoRA adapters (offline, periodic)                │ │
│  │  - Use open-source fine-tuning infrastructure             │ │
│  │  - Store adapters separately from base model               │ │
│  └────────────────────────────┬────────────────────────────────┘ │
│                               │                                    │
│                               ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  A/B Testing: Base vs Base+LoRA                             │ │
│  │  - Measure: success rate, latency, user satisfaction       │ │
│  └────────────────────────────┬────────────────────────────────┘ │
│                               │                                    │
│                               ▼                                    │
│  Deploy if improvement confirmed                                  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

**Constraints**:

- Keep base model fixed
- Only modify adapters
- Human approval required for adapter deployment

---

## Implementation Timeline

```
Week:  1   2   3   4   5   6   7   8   9   10  11  12
       │   │   │   │   │   │   │   │   │   │   │   │
Phase: ├───────┼───────┼───────┼───────┼───────┼───────┤
       │   1   │       │   2   │       │   3   │   4   │
       │       │       │       │       │       │       │
       │ ┌─────┴─────┐ │ ┌─────┴─────┐ │ ┌─────┴─────┐ │
       │ │ 1.1 Vector│ │ │ 2.1 Self  │ │ │ 3.1 Skill │ │
       │ │ 1.2 Decay │ │ │    Refactor│ │ │    Sandbox│ │
       │ │ 1.3 SQLite│ │ │ 2.2 Self  │ │ │ 3.2 Self  │ │
       │ │           │ │ │    Access │ │ │    Verify │ │
       │ └───────────┘ │ └───────────┘ │ └───────────┘ │
                       └───────────────┴───────────────┘
                                                   │
                                        ┌──────────┴──────────┐
                                        │ Phase 4: Knowledge  │
                                        │ Phase 5: LoRA       │
                                        └─────────────────────┘
```

---

## Risk Mitigation

| Risk                               | Mitigation                                 |
| ---------------------------------- | ------------------------------------------ |
| Self-modification breaks system    | Always use PR review; never auto-merge     |
| Vector search degrades performance | Benchmark before/after; optimize queries   |
| Memory bloat                       | Implement TTL and cleanup policies         |
| Model degradation                  | A/B testing with rollback capability       |
| Security vulnerabilities           | Sandboxed execution; constraint validation |

---

## Success Metrics

| Metric                     | Current        | Target          |
| -------------------------- | -------------- | --------------- |
| Memory retrieval accuracy  | ~40% (keyword) | 85%+ (semantic) |
| Self-improvement frequency | 0              | Weekly          |
| Skill approval automation  | 0%             | 80%             |
| Knowledge graph depth      | Flat           | Multi-hop       |
| System autonomy score      | 58/100         | 90+/100         |

---

## Conclusion

This roadmap transforms OpenCode from a "Memory-Enabled Agent" to a "Self-Evolving Organism" through 5 phases over 12 weeks. The key differentiator is moving from passive accumulation to active self-modification, while maintaining safety through human oversight and automated verification.
