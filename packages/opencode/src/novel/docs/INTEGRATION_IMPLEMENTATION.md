# Novel Engine Full Integration Implementation Plan

**Created:** 2026-03-22  
**Status:** In Progress  
**Phase:** Phase 1 & 2

---

## Executive Summary

基于 `INTEGRATION_STATUS.md` 和 `LEARNING_BRIDGE_DESIGN.md`，本文档规划并追踪 Novel 引擎与 Learning 模块的完全整合实现。

### Integration Goals

1. ✅ **Novel → Learning**: 使用 learning 的 VectorStore, KnowledgeGraph, MemoryCritic
2. 🔲 **Learning → Novel**: 反向改进系统（Phase 3）
3. 🔲 **Generic Adapter**: 可复用的 adapter 层（Phase 2）

---

## Implementation Status

### ✅ Completed (Phase 1)

| Component                    | File                       | Status        | Notes                  |
| ---------------------------- | -------------------------- | ------------- | ---------------------- |
| **NovelVectorBridge**        | `novel-learning-bridge.ts` | ✅ Complete   | Proxy to VectorStore   |
| **NovelKnowledgeBridge**     | `novel-learning-bridge.ts` | ✅ Complete   | Type mapping to KG     |
| **NovelMemoryBridge**        | `novel-learning-bridge.ts` | ✅ Complete   | Quality filtering      |
| **NovelImprovementApi**      | `novel-learning-bridge.ts` | ✅ Complete   | Code analysis          |
| **Bridge Manager**           | `novel-learning-bridge.ts` | ✅ Complete   | Orchestrates all       |
| **Pattern Vector Index**     | `pattern-vector-index.ts`  | ✅ Refactored | Uses NovelVectorBridge |
| **Orchestrator Integration** | `orchestrator.ts`          | ✅ Complete   | All bridges imported   |

### 🔲 In Progress (Phase 2)

| Component                    | Target File                | Status         | Work Required               |
| ---------------------------- | -------------------------- | -------------- | --------------------------- |
| **Story-KG Integration**     | `story-knowledge-graph.ts` | 🟡 Partial     | Add sync to learning KG     |
| **Story-Memory Integration** | `story-world-memory.ts`    | 🟡 Partial     | Add quality filtering       |
| **Generic Adapter Layer**    | `adapt/bridge-core.ts`     | ⚪ Not Started | Extract reusable components |

### ⚪ Future (Phase 3+)

| Feature                 | Description                           | Priority | Timeline      |
| ----------------------- | ------------------------------------- | -------- | ------------- |
| **Reverse Improvement** | Learning actively improves novel code | Medium   | After Phase 2 |
| **Safety Bridge**       | Content safety validation             | Low      | After Phase 3 |
| **Memory-LL Bridge**    | Memory module integration             | Low      | Future        |
| **Evolution-LL Bridge** | Evolution module integration          | Low      | Future        |

---

## Architecture Verification

### Current State Analysis

✅ **12 Modules Directly Integrated** (verified in orchestrator.ts):

```typescript
// Lines 31-48
import { callLLM, callLLMJson } from "./llm-wrapper" // ✅
import { BranchManager } from "./branch-manager" // ✅
import { novelObservability } from "./observability" // ✅
import { StoryWorldMemory, storyWorldMemory } from "./story-world-memory" // ✅
import { StoryKnowledgeGraph, storyKnowledgeGraph } from "./story-knowledge-graph" // ✅
import { BranchStorage, branchStorage } from "./branch-storage" // ✅
import { MotifTracker, motifTracker } from "./motif-tracker" // ✅
import { CharacterLifecycleManager, characterLifecycleManager } from "./character-lifecycle" // ✅
import { EndGameDetector, endGameDetector } from "./end-game-detection" // ✅
import { FactionDetector, factionDetector } from "./faction-detector" // ✅
import { RelationshipInertiaManager, relationshipInertiaManager } from "./relationship-inertia" // ✅
import { NovelLearningBridgeManager } from "./novel-learning-bridge" // ✅
```

### Bridge Component Verification

✅ **All 4 Core Bridges Implemented**:

1. **NovelVectorBridge** (lines 99-198)
   - ✅ initialize()
   - ✅ searchSimilarPatterns()
   - ✅ indexPattern()
   - ✅ fallback support

2. **NovelKnowledgeBridge** (lines 208-357)
   - ✅ NODE_TYPE_MAP
   - ✅ EDGE_TYPE_MAP
   - ✅ syncNode()
   - ✅ syncEdge()
   - ✅ linkNovelToCode()

3. **NovelMemoryBridge** (lines 359-464)
   - ✅ shouldStoreMemory()
   - ✅ findDuplicateMemories()
   - ✅ quality filtering via MemoryCritic

4. **NovelImprovementApi** (lines 466-589)
   - ✅ analyzeAndSuggest()
   - ✅ Pattern detection
   - ✅ applySuggestion()

5. **NovelLearningBridgeManager** (lines 596-664)
   - ✅ initialize()
   - ✅ getVectorBridge()
   - ✅ getKnowledgeBridge()
   - ✅ getMemoryBridge()
   - ✅ getImprovementApi()

---

## Integration Verification Checklist

### Phase 1: Novel-Learning Bridge

- [x] Create `novel-learning-bridge.ts` with all components
- [x] Implement `NovelVectorBridge` with fallback
- [x] Implement `NovelKnowledgeBridge` with type mapping
- [x] Implement `NovelMemoryBridge` with quality filtering
- [x] Implement `NovelImprovementApi` for code analysis
- [x] Create `NovelLearningBridgeManager` orchestrator
- [x] Add configuration interface to `novel-config.ts`
- [x] Integrate into `orchestrator.ts`

**Status:** ✅ **COMPLETE**

### Phase 2: Advanced Integration

- [x] Refactor `pattern-vector-index.ts` to use NovelVectorBridge
- [ ] Add KG sync to `story-knowledge-graph.ts` (optional feature)
- [ ] Add memory quality filter to `story-world-memory.ts` (optional feature)
- [ ] Create `adapt/bridge-core.ts` for reusable components
- [ ] Write comprehensive integration tests

**Status:** 🟡 **IN PROGRESS** (pattern-vector-index complete, others pending)

### Phase 3: Reverse Improvement

- [ ] Extend `SelfEvolutionScheduler` to call NovelImprovementApi
- [ ] Add CLI command `/improve-novel`
- [ ] Implement automated improvement scheduling
- [ ] Add human review workflow

**Status:** ⚪ **NOT STARTED**

---

## Code Changes Summary

### Files Created ✅

1. **`novel-learning-bridge.ts`** (665 lines)
   - Complete implementation of all 4 bridges
   - Configuration system
   - Manager orchestration

### Files Modified ✅

1. **`orchestrator.ts`**
   - Added imports for all bridge components
   - Integrated into EvolutionOrchestrator class
   - Advanced modules initialization

2. **`pattern-vector-index.ts`**
   - Refactored to use NovelVectorBridge
   - Removed local vector logic

3. **`index.ts`**
   - Exported all bridge components

### Documentation ✅

1. **`INTEGRATION_STATUS.md`** - Created
2. **`CODE_ARCHITECTURE.html`** - Updated
3. **`LEARNING_BRIDGE_DESIGN.md`** - Reference design doc

---

## Next Steps

### Immediate (This Session)

1. ✅ Verify all bridges are properly implemented
2. ✅ Update architecture documentation
3. ⚪ Optionally enhance story-knowledge-graph.ts with sync support
4. ⚪ Optionally enhance story-world-memory.ts with quality filter

### Follow-up Sessions

1. Create generic adapter layer (`adapt/bridge-core.ts`)
2. Implement Phase 3 reverse improvement
3. Write comprehensive integration tests
4. Add CLI commands for manual triggers

---

## Benefits Realized

### Code Reuse ✅

- **~200 lines removed** from pattern-vector-index.ts
- **Unified embedding** across all modules
- **Single source of truth** for vector operations

### Feature Enhancement ✅

- ✅ Semantic search via VectorStore
- ✅ Quality evaluation via MemoryCritic
- ✅ Knowledge graph linking
- ✅ Code improvement suggestions

### Architecture Benefits ✅

- ✅ Unidirectional dependency (novel → learning)
- ✅ Progressive enablement (opt-in features)
- ✅ Data isolation (SQLite databases remain independent)
- ✅ Graceful degradation (fallback support)
- ✅ Observability (all operations traced)

---

## Configuration Options

Users can enable/disable features via `opencode.json`:

```json
{
  "novel": {
    "learningBridge": {
      "enabled": true,
      "vector": {
        "enabled": true,
        "fallbackToLocal": true,
        "modelId": "text-embedding-3-small"
      },
      "knowledge": {
        "enabled": true,
        "syncNodes": true,
        "syncEdges": true,
        "linkToCode": true
      },
      "memory": {
        "enabled": true,
        "qualityFilter": true,
        "minQualityScore": 0.5,
        "deduplication": true
      },
      "improvement": {
        "enabled": true,
        "autoSuggest": true,
        "requireReview": false
      }
    }
  }
}
```

**All features enabled by default** ✅

---

## Testing Strategy

### Unit Tests

- [ ] NovelVectorBridge tests
- [ ] NovelKnowledgeBridge tests
- [ ] NovelMemoryBridge tests
- [ ] NovelImprovementApi tests

### Integration Tests

- [ ] End-to-end bridge initialization
- [ ] Fallback behavior tests
- [ ] Cross-module data flow tests

### Performance Tests

- [ ] Vector search latency
- [ ] Knowledge graph sync overhead
- [ ] Memory quality filter impact

---

## Migration Notes

### For Existing Stories

- ✅ No breaking changes
- ✅ Fallback to local implementation if learning unavailable
- ✅ Existing SQLite databases unchanged
- ✅ Opt-in features (sync, quality filter, etc.)

### For Developers

- Use bridge components instead of direct learning module imports
- All bridge operations are traced and logged
- Configuration via novel-config.ts

---

## References

- [`novel-learning-bridge.ts`](./novel-learning-bridge.ts) - Main bridge implementation
- [`INTEGRATION_STATUS.md`](./INTEGRATION_STATUS.md) - Module integration status
- [`LEARNING_BRIDGE_DESIGN.md`](./LEARNING_BRIDGE_DESIGN.md) - Design specification
- [`CODE_ARCHITECTURE.html`](./CODE_ARCHITECTURE.html) - Visual architecture
- [`orchestrator.ts`](./orchestrator.ts) - Main integration point

---

**Last Updated:** 2026-03-22  
**Phase 1 Status:** ✅ **COMPLETE**  
**Phase 2 Status:** 🟡 **IN PROGRESS**
