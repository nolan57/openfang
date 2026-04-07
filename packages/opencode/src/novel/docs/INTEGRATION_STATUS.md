# Novel Engine Module Integration Status

**Last Updated:** 2026-03-22  
**Total Modules:** 38 (excluding tests)

## Integration Summary

| Status                | Count | Percentage |
| --------------------- | ----- | ---------- |
| ✅ Direct Integration | 12    | 31.6%      |
| 🔵 Indirect Usage     | 6     | 15.8%      |
| 🟡 Standalone/Testing | 3     | 7.9%       |
| ⚪ Not Yet Integrated | 3     | 7.9%       |
| 🎯 Entry Points       | 2     | 5.3%       |
| 🔧 Utility/Config     | 12    | 31.6%      |

---

## ✅ Direct Integration (12 modules)

These modules are directly imported and used by `orchestrator.ts` in the main story generation pipeline.

| Module                       | Line  | Purpose                                | Integration Point                          |
| ---------------------------- | ----- | -------------------------------------- | ------------------------------------------ |
| **llm-wrapper.ts**           | 31    | Unified LLM interface with retry logic | All LLM calls                              |
| **branch-manager.ts**        | 32    | Branch scoring, pruning & merging      | `addBranch()`, `autoMergeSimilarBranches()`, `pruneBranches()`, `getStats()` |
| **observability.ts**         | 33    | Performance tracing & monitoring       | Wrapped around all phases                  |
| **story-world-memory.ts**    | 34    | Hierarchical memory system             | Context management                         |
| **story-knowledge-graph.ts** | 35    | Knowledge graph for story entities     | Long-term context                          |
| **branch-storage.ts**        | 36    | Persistent branch storage              | Database backend                           |
| **motif-tracker.ts**         | 37    | Motif evolution tracking               | Per-chapter analysis + knowledge graph sync |
| **character-lifecycle.ts**   | 38    | Character lifecycle management         | Character creation/exit, aging, life events, persistence |
| **end-game-detection.ts**    | 39    | Story completion detection             | Early exit logic                           |
| **faction-detector.ts**      | 40    | Faction formation detection            | Group dynamics                             |
| **relationship-inertia.ts**  | 41    | Relationship stability                 | Plot hook generation                       |
| **novel-learning-bridge.ts** | 43-48 | Learning system integration            | Phase 3 reverse improvement                |

### Integration Example

```typescript
// orchestrator.ts imports
import { callLLM, callLLMJson } from "./llm-wrapper"
import { BranchManager } from "./branch-manager"
import { novelObservability } from "./observability"
import { StoryWorldMemory, storyWorldMemory } from "./story-world-memory"
import { StoryKnowledgeGraph, storyKnowledgeGraph } from "./story-knowledge-graph"
import { BranchStorage, branchStorage } from "./branch-storage"
import { MotifTracker, motifTracker } from "./motif-tracker"
import { CharacterLifecycleManager, characterLifecycleManager } from "./character-lifecycle"
import { EndGameDetector, endGameDetector } from "./end-game-detection"
import { FactionDetector, factionDetector } from "./faction-detector"
import { RelationshipInertiaManager, relationshipInertiaManager } from "./relationship-inertia"
import { NovelLearningBridgeManager } from "./novel-learning-bridge"

export class EvolutionOrchestrator {
  private branchManager: BranchManager
  private storyWorldMemory: StoryWorldMemory
  private storyKnowledgeGraph: StoryKnowledgeGraph
  private branchStorage: BranchStorage
  private motifTracker: MotifTracker
  private characterLifecycleManager: CharacterLifecycleManager
  private endGameDetector: EndGameDetector
  private factionDetector: FactionDetector
  private relationshipInertiaManager: RelationshipInertiaManager
  private learningBridgeManager: NovelLearningBridgeManager

  constructor(config: OrchestratorConfig = {}) {
    this.branchManager = new BranchManager()
    this.storyWorldMemory = storyWorldMemory
    this.storyKnowledgeGraph = storyKnowledgeGraph
    this.branchStorage = branchStorage
    this.motifTracker = motifTracker
    this.characterLifecycleManager = characterLifecycleManager
    this.endGameDetector = endGameDetector
    this.factionDetector = factionDetector
    this.relationshipInertiaManager = relationshipInertiaManager
    this.learningBridgeManager = new NovelLearningBridgeManager(config.learningBridgeConfig)
  }
}
```

---

## 🔵 Indirect Usage (6 modules)

These modules are used by other integrated modules but not directly by orchestrator.ts.

| Module                        | Used By                | Purpose                     |
| ----------------------------- | ---------------------- | --------------------------- |
| **continuity-analyzer.ts**    | visual-orchestrator.ts | Visual continuity checking  |
| **dynamic-prompt.ts**         | evolution-rules.ts, character-deepener.ts, orchestrator.ts | Dynamic prompt construction + MetaLearner |
| **model.ts**                  | All LLM modules        | LLM provider acquisition    |
| **validation.ts**             | llm-wrapper.ts         | Retry logic & validation    |
| **visual-prompt-engineer.ts** | visual-orchestrator.ts | Visual prompt generation    |
| **pattern-miner.ts**          | command-parser.ts      | Pattern analysis (/evolve)  |

---

## 🎯 Entry Points (2 modules)

These modules serve as separate entry points to the novel engine.

| Module                | Purpose                   | Usage                                  |
| --------------------- | ------------------------- | -------------------------------------- |
| **command-parser.ts** | CLI slash command handler | `/start`, `/continue`, `/evolve`, etc. |
| **index.ts**          | Public API exports        | External module consumption            |

---

## 🟡 Standalone/Testing (3 modules)

These modules are designed for standalone use or testing purposes.

| Module                        | Status     | Purpose                                |
| ----------------------------- | ---------- | -------------------------------------- |
| **improvement-scheduler.ts**  | Standalone | Scheduled improvement tasks            |
| **pattern-miner-enhanced.ts** | Testing    | Enhanced pattern mining (experimental) |
| **pattern-vector-index.ts**   | Testing    | Vector-based pattern search            |

---

## ⚪ Not Yet Integrated (3 modules)

These modules exist in the codebase but are not yet integrated into the main pipeline.

| Module                        | Purpose                     | Future Integration           |
| ----------------------------- | --------------------------- | ---------------------------- |
| **multi-thread-narrative.ts** | Parallel storylines         | Complex multi-plot stories   |
| **multiway-relationships.ts** | Group relationship dynamics | Complex social networks      |
| **procedural-world.ts**       | Procedural world generation | Auto-generate locations/NPCs |

---

## 🔧 Utility & Configuration (12 modules)

These modules provide core functionality, configuration, or utilities.

| Module                       | Category      | Purpose                       |
| ---------------------------- | ------------- | ----------------------------- |
| **novel-config.ts**          | Configuration | Unified configuration system  |
| **types.ts**                 | Types         | Type definitions & constants  |
| **narrative-skeleton.ts**    | Structure     | Story structure planning      |
| **thematic-analyst.ts**      | Analysis      | Periodic thematic reflection  |
| **character-deepener.ts**    | Analysis      | Character psychology analysis |
| **relationship-analyzer.ts** | Analysis      | Relationship dynamics         |
| **state-extractor.ts**       | Core          | State change extraction       |
| **evolution-rules.ts**       | Core          | Chaos system & validation     |
| **visual-orchestrator.ts**   | Visual        | Visual panel coordination     |
| **visual-translator.ts**     | Visual        | Visual translation utilities  |
| **performance.ts**           | Utility       | Performance utilities         |
| **config/**                  | Configuration | Config loader utilities       |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Entry Points                            │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │ command-     │  │ index.ts     │                        │
│  │ parser.ts    │  │ (exports)    │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  Core Orchestrator                          │
│  ┌────────────────────────────────────────────────────┐    │
│  │ orchestrator.ts                                    │    │
│  │  - llm-wrapper.ts ✅                               │    │
│  │  - branch-manager.ts ✅                            │    │
│  │  - observability.ts ✅                             │    │
│  │  - story-world-memory.ts ✅                        │    │
│  │  - story-knowledge-graph.ts ✅                     │    │
│  │  - branch-storage.ts ✅                            │    │
│  │  - motif-tracker.ts ✅                             │    │
│  │  - character-lifecycle.ts ✅                       │    │
│  │  - end-game-detection.ts ✅                        │    │
│  │  - faction-detector.ts ✅                          │    │
│  │  - relationship-inertia.ts ✅                      │    │
│  │  - novel-learning-bridge.ts ✅                     │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Indirect Dependencies                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ continuity-  │  │ dynamic-     │  │ model.ts     │     │
│  │ analyzer.ts  │  │ prompt.ts    │  │ (LLM prov)   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ validation-  │  │ visual-      │  │ pattern-     │     │
│  │ ts           │  │ prompt-eng   │  │ miner.ts     │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Standalone / Future                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ multi-thread │  │ multiway-rel │  │ procedural-  │     │
│  │ -narrative   │  │ ationships   │  │ world        │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## Integration Timeline

### Phase 1: Core Integration ✅ (Completed)

- ✅ LLM wrapper with retry logic
- ✅ Branch manager with configurable weights
- ✅ Basic observability

### Phase 2: Advanced Features ✅ (Completed)

- ✅ Story world memory (hierarchical)
- ✅ Story knowledge graph
- ✅ Branch storage (database)
- ✅ Motif tracker
- ✅ Character lifecycle
- ✅ End game detection
- ✅ Faction detector
- ✅ Relationship inertia
- ✅ Novel learning bridge

### Phase 3: Future Enhancements 🔲

- 🔲 Multi-thread narrative
- 🔲 Multiway relationships
- 🔲 Procedural world generation
- 🔲 Enhanced pattern miner (production)

---

## Notes

1. **Module Count**: Total of 38 TypeScript files (excluding `.test.ts` files)
2. **Integration Rate**: 31.6% direct integration, 47.4% total usage (including indirect)
3. **Active Development**: 3 modules marked for future integration
4. **Entry Points**: 2 separate entry points (CLI and module API)

---

## See Also

- [`CODE_ARCHITECTURE.html`](./CODE_ARCHITECTURE.html) - Visual architecture diagrams
- [`MIGRATION_GUIDE.md`](./MIGRATION_GUIDE.md) - Hardcoding migration guide
- [`AGENTS.md`](../AGENTS.md) - Development guidelines
