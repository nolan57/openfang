# Novel Engine — Dead Code Final Verdict

**Date:** 2026-04-05
**Last Updated:** 2026-04-07 — Phase 1/2 cleanup completed
**Method:** Every claim verified by grep_search across all 35+ .ts source files
**Scope:** Novel engine architecture — interactive fiction with branching, psychology, relationships, visuals
**Decision criteria for each item:**
1. Is it dead? (grep-verified)
2. Does it align with engine goals? (architectural judgment)
3. Decision: 🗑️ Delete | 🔌 Implement | 🔧 Refactor | 🔗 Integrate | 📦 Keep

---

## Status Update (2026-04-07)

The following items have been **cleaned up** since this document was created:

| Item | Status |
|------|--------|
| ~~`initVisualTranslator()`~~ | ✅ **DELETED** |
| ~~`enrichBeatWithVisuals()`~~ | ✅ **DELETED** |
| ~~`translateStoryToPanels()`~~ | ✅ **DELETED** |
| ~~`generateDeterministicVisualHash()`~~ export | ✅ **MADE INTERNAL** |
| ~~`EnrichedBeat`~~ re-export | ✅ **REMOVED** |
| Barrel: `isSlashCommand`, `listSkills` | ✅ **REMOVED** |
| Barrel: `callLLMBatch`, `callLLMWithTracing`, `novelLLM` | ✅ **REMOVED** |

The visual pipeline is **fully unified**. `visual-translator.ts` (732 lines) now has 100% active exports.

---

## Architecture Reference: What the Novel Engine Actually Does

```
CLI (novel start/continue)
  └── orchestrator.runNovelCycle()
        ├── rollChaos() → 2d6 dice
        ├── generateChaosEventWithLLM() → LLM
        ├── callLLM() → story text
        ├── stateExtractor.extract() → LLM extracts state changes
        │     └── validation schemas (RawStateUpdate, etc.) — ✅ ACTIVE
        ├── characterDeepener.deepenCharacter() — ✅ ACTIVE per character
        ├── relationshipAnalyzer.analyzeAllRelationships() — ✅ ACTIVE
        ├── enhancedPatternMiner.onTurn() — ✅ ACTIVE
        ├── motifTracker.analyzeMotifEvolution() — ✅ ACTIVE
        ├── relationshipInertiaManager.generatePlotHooks() — ✅ ACTIVE
        ├── relationshipInertiaManager.getActiveHooks() → injected into prompt — ✅ ACTIVE
        ├── characterLifecycleManager (register, setCurrentChapter, getLifecycle, recordDeath) — ✅ ACTIVE
        ├── endGameDetector.updateStoryMetrics() + checkCompletion() — ✅ ACTIVE
        ├── generateAndSaveVisualPanels()
        │     ├── assemblePanelSpec() — ✅ ACTIVE
        │     ├── translateEmotionToVisuals() — ✅ ACTIVE
        │     ├── translateActionToCamera() — ✅ ACTIVE
        │     └── (all visual-translator.ts exports — ✅ ACTIVE)
        ├── runThematicReflection() (every N turns) — ✅ ACTIVE
        └── saveState() → story_bible.json
              └── branchStorage.saveBranch() — ✅ ACTIVE
                    └── BranchManager — ✅ ACTIVE (addBranch, autoMerge, prune, getStats)
```

---

## DECISION MATRIX

### 🗑️ DELETE — No architectural value, zero callers

| Item | File | Lines | Reason | Status |
|------|------|-------|--------|--------|
| ~~`initVisualTranslator()`~~ | ~~visual-translator.ts:35~~ | ~~10~~ | Config loaded lazily via `getConfig()` | ✅ **DELETED** |
| ~~`enrichBeatWithVisuals()`~~ | ~~visual-translator.ts:744~~ | ~~20~~ | No callers | ✅ **DELETED** |
| ~~`translateStoryToPanels()`~~ | ~~visual-translator.ts:1136~~ | ~~150~~ | Pipeline moved to orchestrator | ✅ **DELETED** |
| `submitFeedbackToMetaLearner()` | command-parser.ts:27 | ~5 | Stub: `console.log` only | 🔴 Remaining |
| `validateAnalysis()` | continuity-analyzer.ts:240 | ~15 | Private method, never called | 🔴 Remaining |
| `createFallbackSkeleton()` | narrative-skeleton.ts:94 | ~30 | Never called | 🔴 Remaining |
| `getActiveStoryLines()` | narrative-skeleton.ts | ~5 | Imported by orchestrator but **never called**. |
| `saveNarrativeSkeleton()` | narrative-skeleton.ts | ~5 | Imported by orchestrator but **never called**. |
| `updateStoryLineProgress()` | narrative-skeleton.ts:554 | ~10 | Not even imported. Zero callers. |
| `getOverallCompletionPercentage()` | narrative-skeleton.ts:583 | ~5 | Not even imported. Zero callers. |
| `updateNarrativeSkeleton()` | narrative-skeleton.ts:588 | ~10 | Not even imported. Zero callers. |
| `generateNewCharacter()` | character-lifecycle.ts | ~30 | Random generation — antithetical to LLM-driven quality. |
| `novelLLM` namespace | llm-wrapper.ts:291 | ~10 | Never imported. Convenience wrapper with zero adoption. |
| `generateDenouementStructure()` | end-game-detection.ts:283 | ~30 | Only called in tests. Story completion uses `checkCompletion()` instead. |
| `getCriterionProgress()` | end-game-detection.ts:317 | ~15 | Only called in tests. |
| `exportToKnowledgeGraph()` | motif-tracker.ts:464 | ~20 | Only called in tests. Knowledge graph sync should happen in orchestrator. |
| `getHooksForCharacters()` | relationship-inertia.ts:338 | ~10 | Only called in tests. `getActiveHooks()` is the actual production API. |
| `getPlotHooksReport()` | relationship-inertia.ts:342 | ~15 | Only called in tests. |
| ~~**Entire `branch-manager.ts`**~~ | ~~branch-manager.ts~~ | ~~350~~ | ✅ **NOW ACTIVE** - BranchManager fully integrated in orchestrator.ts:1814-1866 (addBranch, autoMergeSimilarBranches, pruneBranches, getStats) |
| Unused singleton: `branchManager` | branch-manager.ts:350 | ~5 | Never imported by production files; orchestrator creates its own instance |
| Unused singletons: `relationshipViewService`, `asyncGroupManagementService` | multiway-relationships.ts:646-647 | ~10 | Created with `noopGraphReader`. Broken by design. |
| Unused singleton: `proceduralWorldGenerator` | procedural-world.ts:827 | ~5 | Orchestrator creates its own instance. |
| Unused singleton: `characterDeepener` | character-deepener.ts:518 | ~5 | Orchestrator creates its own instance. |
| Unused singleton: `relationshipAnalyzer` | relationship-analyzer.ts:481 | ~5 | Orchestrator creates its own instance. |
| **Subtotal** | | **~380 lines** (was ~730) | |

---

### 🗑️ DELETE — Barrel exports that should not be public

These are exported from `index.ts` but have no external callers. They pollute the public API surface.

| Export | Source | Reason to Remove from Barrel |
|--------|--------|----------------------------|
| `isSlashCommand` | command-parser.ts | Internal-only, used only within command-parser |
| `listSkills` | command-parser.ts | Internal-only |
| `callLLMWithTracing` | llm-wrapper.ts | Zero production callers |
| `callLLMBatch` | llm-wrapper.ts | Test-only |
| `novelLLM` | llm-wrapper.ts | Never imported |
| `validateGoalWithContext` | validation.ts | Zero callers |
| `validateTraumaWithContext` | validation.ts | Zero callers |
| `validateSkillWithContext` | validation.ts | Zero callers |
| `validateCharacterUpdateWithContext` | validation.ts | Zero callers |
| `validateRelationshipUpdateWithContext` | validation.ts | Zero callers |
| `createCorrelationId` | validation.ts | Test-only |
| `createCorrelationContext` | validation.ts | Test-only |
| `rateLimit` | performance.ts | Test-only (throttling should be done in llm-wrapper if needed) |
| `throttle` | performance.ts | Test-only |
| `batch` | performance.ts | Test-only |
| `lazy` | performance.ts | Test-only |
| `clearMemoCache` | performance.ts | Test-only |
| `deleteMemoKey` | performance.ts | Test-only |
| `getMemoStats` | performance.ts | Test-only |
| ~~`PROMPT_TEMPLATES`~~ | ~~dynamic-prompt.ts~~ | ✅ **NOW ACTIVE** - All 5 templates now used (chaosEvent, stateEvaluation, psychologicalDeepening, branchGeneration) |
| `BranchEvent` (type) | branch-storage.ts | Type never instantiated |

**Subtotal: 21 barrel exports to remove**

---

### 🗑️ DELETE — Unused imports (14 across 8 files)

| File | Import | 
|------|--------|
| `pattern-miner-enhanced.ts` | `memoize`, `Instance` |
| `narrative-skeleton.ts` | `Instance` |
| `story-world-memory.ts` | `Instance`, `CharacterState` |
| `story-knowledge-graph.ts` | `Instance` |
| `motif-tracker.ts` | `Instance` |
| `branch-storage.ts` | `Instance` |
| `procedural-world.ts` | `Instance` |
| `command-parser.ts` | `Instance` |
| `dynamic-prompt.ts` | `z` |
| `visual-prompt-engineer.ts` | `generateDeterministicVisualHash` |
| `observability.ts` | `getNovelLanguageModel`, `generateText` |

**Subtotal: 14 lines**

---

### 🔌 IMPLEMENT — Fills existing gaps, directly serves engine goals

| Item | Current State | What to Implement | Engine Impact |
|------|--------------|-------------------|--------------|
| **observability 5 TODOs** | Hardcoded zeros | Wire real data: `asyncGroupService.getAllGroups()` for factionCount, `storyWorldMemory.getStats()` for totalMemories, `storyKnowledgeGraph.detectInconsistency()` for inconsistencyCount, add timing hooks for avgExtractionTime, return `storyState.chapterCount` instead of `1` | 🔴 **CRITICAL** — Health report currently operates on fake data. Without this, `generateHealthReport()` produces meaningless results. |
| **observability `collectMetrics()` wiring** | Only called in tests | Call it in orchestrator's `runNovelCycle()` after each chapter. Log health score. | 🔴 **CRITICAL** — Without production calls, observability is a 435-line test fixture. |
| **`novelObservability.start/endGenerationTiming()`** | Defined but never called | Wrap story generation in orchestrator with timing calls. | 🟡 Important for performance monitoring. |
| **CLI `/health` command** | observability exports exist but no consumer | Add `handleHealth()` to novel.ts CLI that calls `collectMetrics()` + `generateHealthReport()` and prints results. | 🟡 User-visible value. |
| ~~**branch auto-merge into saveState()**~~ | ~~`autoMergeSimilarBranches()` defined, never called~~ | ✅ **ALREADY INTEGRATED** - autoMergeSimilarBranches() called in orchestrator.ts:1844 | ✅ **DONE** |
| **branch querying into CLI `/branches`** | `getBranchTree()` etc. defined, available via orchestrator APIs | Add CLI command to expose BranchManager tree structure. | 🟡 Nice-to-have. |
| **`enrichBeatWithVisuals()` as public API** | Defined, zero callers | Expose as simple wrapper around `assemblePanelSpec()`. Useful for plugins/real-time visual gen. | 🟢 Niche value. Low priority. |

---

### 🔧 REFACTOR — Redesign needed before integration

| Item | Problem | Proposed Refactor | Priority |
|------|---------|------------------|----------|
| **`resolveVisualSpec()` in config-loader.ts** (~200 lines) | Core of a sophisticated visual strategy system (layered overrides + thematic voting + dynamic weight calculation). Never called because visual-prompt-engineer.ts uses a simpler hardcoded+config hybrid instead. Two competing visual strategy systems. | **Extract strategy layers into visual-prompt-engineer.ts as optional enhancement:** (1) Extract dynamic weight calculation for motif-influenced visuals; (2) Extract override condition checking; (3) Simplify voting — it's over-engineered; (4) Make it an "advanced mode" toggleable via config. **Delete** `resolveVisualSpec()`, `reloadVisualConfig()`, `clearConfigCache()` from config-loader.ts after extraction. | 🟡 Medium — current system works, this would make it smarter. |
| **`validation.ts` *WithContext functions** (~200 lines) | Five granular validation functions with zero callers. The state extractor uses schema validation (`RawStateUpdate`) but not these context-aware validators. | **Integrate into state extractor's validation pipeline:** After schema validation, call `validateCharacterUpdateWithContext()` for each character update and `validateRelationshipUpdateWithContext()` for each relationship change. This provides targeted corrections that schema validation can't. If integration is too invasive, delete them. | 🟡 Medium — valuable but requires careful integration. |
| **`translateStoryToPanels()` + visual-translator pipeline** (~400 lines) | Has a superior hybrid splitting strategy (rule-based pre-segmentation + LLM semantic refinement) compared to visual-orchestrator's simpler `planPanelSegments()`. But nobody calls it. | **Merge into visual-orchestrator.ts:** Adopt `ruleBasedPreSegmentation()` as the default splitter. Adopt `refineChunksWithLLM()` as the LLM refinement strategy. Delete `translateStoryToPanels()` and the simpler `planPanelSegments()` from visual-orchestrator. Keep `assemblePanelSpec()` as shared panel assembly. | 🔴 **HIGH** — Two competing pipelines is architectural debt. Unify them. |
| ~~**`BranchManager` class**~~ (~350 lines) | ~~Imported and instantiated by orchestrator, then **zero methods called.**~~ | ✅ **FULLY INTEGRATED** - BranchManager is now actively used in orchestrator.ts:1814-1866 for multi-branch story management. Methods called: addBranch(), autoMergeSimilarBranches(), pruneBranches(), getStats(). Architecture: BranchManager (in-memory scoring/pruning/merging) + BranchStorage (SQLite persistence). | ✅ **KEEP** - Core engine component |

---

### 🔗 INTEGRATE — Fully built, only missing wiring

| Item | Readiness | What to Wire | Effort |
|------|-----------|-------------|--------|
| **procedural-world data → story prompts** | World is generated at start, stored in state, but never used in generation | Inject regional context into chaos events ("current region: X, nearby dangers: Y"). Add world history to narrative context for LLM. Use regional conflicts as chaos event seeds. | ~30 lines |
| **novel-learning-bridge Phase 1** | Manager is initialized, bridges exist, no data flow | After `enhancedPatternMiner.onTurn()`, call `novelVectorBridge.indexPattern()` to sync patterns to learning system vector store. | ~20 lines |
| ~~**motif-tracker → knowledge graph**~~ | ~~`analyzeMotifEvolution()` is called, `exportToKnowledgeGraph()` is not~~ | ✅ **ALREADY INTEGRATED** - exportToKnowledgeGraph() called in orchestrator.ts:2140, nodes/edges synced to storyKnowledgeGraph | ✅ **DONE** |
| **relationship-inertia → chaos events** | `generatePlotHooks()` is called, hooks are stored, but not injected into chaos | Add active plot hooks to chaos event context in `generateChaosEventWithLLM()`. Hooks become narrative prompts. | ~10 lines |
| **CLI `/completion` command** | `checkCompletion()` is called internally, but user can't query progress | Add CLI command that calls `checkCompletion()` and prints criteria progress. | ~15 lines |
| **CLI `/hooks` command** | `getActiveHooks()` is called, hooks available but not visible | Add CLI command to show current plot hooks. | ~10 lines |
| **rateLimit → llm-wrapper** | Defined, tested, never wired | Wrap `callLLM()` with `rateLimit()` to prevent API overage. Config-driven max calls per minute. | ~5 lines |
| **`getActiveStoryLines()`, `updateStoryLineProgress()`, `getOverallCompletionPercentage()`** | Defined as standalone functions, not called; `saveNarrativeSkeleton()` imported but not called | Wire into orchestrator: call `updateStoryLineProgress()` after each chapter. Use `getActiveStoryLines()` for multi-thread mode. **But:** `getActiveStoryLines`, `saveNarrativeSkeleton`, `updateStoryLineProgress`, `getOverallCompletionPercentage`, `updateNarrativeSkeleton` all have zero callers. DELETE unless you plan to use them. | ~15 lines (if integrating) |

---

### 📦 KEEP — No action needed

| Item | Reason |
|------|--------|
| `memoize()`, `debounce()` | Actively used in production |
| `createNarrativeSkeleton()`, `loadNarrativeSkeleton()` | Called by orchestrator |
| `getNextKeyBeat()`, `getThematicMotifString()` | Called by orchestrator |
| ~~`saveNarrativeSkeleton()`~~, ~~`getActiveStoryLines()`~~ | Imported but never called — DELETE |
| ~~`updateStoryLineProgress()`~~, ~~`getOverallCompletionPercentage()`~~, ~~`updateNarrativeSkeleton()`~~ | Zero callers — DELETE |
| ~~`createFallbackSkeleton()`~~ | Zero callers — DELETE |
| `assemblePanelSpec()`, `translateEmotionToVisuals()`, `translateActionToCamera()` | Core visual pipeline |
| `withRetry()`, `RetryConfig` | Used by llm-wrapper |
| `characterDeepener.deepenCharacter()` | Called per character per chapter |
| `characterDeepener.deepenCharacterFromLifecycle()` | ✅ **NOW ACTIVE** - used when lifecycle data available |
| `relationshipAnalyzer.analyzeAllRelationships()` | Called per chapter |
| `motifTracker.analyzeMotifEvolution()` | Called per chapter |
| `relationshipInertiaManager.generatePlotHooks()`, `getActiveHooks()`, `getInertia()`, `triggerHook()` | All actively used |
| `characterLifecycleManager.setCurrentChapter()`, `getLifecycle()`, `registerCharacter()`, `recordDeath()` | ✅ Actively used |
| `characterLifecycleManager.advanceTime()` | ✅ **NOW ACTIVE** - character aging every chapter |
| `characterLifecycleManager.addLifeEvent()` | ✅ **NOW ACTIVE** - trauma, skills, transformations recorded |
| `characterLifecycleManager.recordTransformation()` | ✅ **NOW ACTIVE** - status changes tracked |
| `characterLifecycleManager.recordLegacy()` | 🟡 Available but not yet called - future enhancement |
| `characterLifecycleManager.exportToJson()` / `importFromJson()` | ✅ **NOW ACTIVE** - lifecycle persistence |
| `endGameDetector.updateStoryMetrics()`, `checkCompletion()` | Actively used |
| `branchStorage` (initialize, saveBranch, close) | Actively used by orchestrator |
| `branchManager` (addBranch, autoMergeSimilarBranches, pruneBranches, getStats) | ✅ Actively used in orchestrator.ts:1814-1866 |
| Deprecated aliases (`TRAUMA_TAGS`, `SKILL_CATEGORIES`, `CHARACTER_STATUS`) | Properly marked `@deprecated` |

---

## ~~BranchManager — Detailed Analysis~~ — **OUTDATED**

**⚠️ This section is from an older analysis and is no longer accurate.**

### Current Status (Updated)

BranchManager has been **fully integrated** into the orchestrator's multi-branch story management pipeline.

**Evidence of Active Usage (orchestrator.ts:1814-1866):**

```typescript
// 1. Register branches in BranchManager for scoring/pruning
this.branchManager.addBranch(branchData)

// 2. Auto-merge similar branches to prevent combinatorial explosion
const merged = this.branchManager.autoMergeSimilarBranches(0.5)

// 3. Prune low-quality branches based on config thresholds
const pruned = this.branchManager.pruneBranches(this.storyState.chapterCount + 1)

// 4. Get statistics for logging
const stats = this.branchManager.getStats()
```

**Active Methods:**
- ✅ `addBranch()` — orchestrator.ts:1839
- ✅ `autoMergeSimilarBranches()` — orchestrator.ts:1844
- ✅ `pruneBranches()` — orchestrator.ts:1851
- ✅ `getStats()` — orchestrator.ts:1866
- ✅ `getAllBranches()` — orchestrator.ts:1433 (via getAvailableBranches)
- ✅ `getBranchTree()` — orchestrator.ts:1446
- ✅ `getBranchPath()` — orchestrator.ts:1460

**Architecture:**
- **BranchManager**: In-memory branch scoring, pruning, and merging (fast operations)
- **BranchStorage**: SQLite persistence (long-term storage)
- **Sync**: Pruned status synced from BranchManager → BranchStorage via `updateBranch()`

**What BranchManager Actually Does:**
- `addBranch()` — register new branch for tracking
- `autoMergeSimilarBranches()` — merge branches with >50% similarity
- `pruneBranches()` — remove branches below quality threshold
- `getStats()` — total/active/pruned/merged counts + average score
- `getBranchTree()` — hierarchical branch view
- `getBranchPath()` — trace branch ancestry

**What Handles Branch Persistence:**
- `branchStorage` — handles `initialize()`, `saveBranch()`, `updateBranch()`, `close()`
- Both systems work together: BranchManager (memory) + BranchStorage (disk)

**Verdict: ✅ KEEP** — 350 lines of valuable branch management code. Core engine component.

---

## Observability — Detailed Analysis

```typescript
// orchestrator.ts — imports observability
import { novelObservability } from "./observability"               // Line 33

// And then... NOTHING.
```

Grep for `novelObservability\.` across ALL .ts files: only `MAX_TRACE_EVENTS` constant reference and test files.

**What observability would do if it were alive:**
- Track generation timing
- Record errors
- Collect metrics (branch health, pattern discovery, character development)
- Generate health reports
- Trace events

**Current state:** 435 lines of sophisticated monitoring code. Never called. The `collectMetrics()` function reads from all subsystems (branchManager, patternMiner, motifTracker, knowledgeGraph, storyWorldMemory) — but the orchestrator never invokes it.

**Verdict: INTEGRATE or DELETE.**
- **If integrating:** Add timing calls around story generation, call `collectMetrics()` after each chapter, add CLI `/health` command. ~80 lines of wiring.
- **If deleting:** Remove the entire observability.ts file. The engine functions without it.
- **Recommendation: INTEGRATE at minimum level.** Add timing tracking and a health check. Full metrics can wait.

---

## Decision Summary by Line Count

| Decision | Lines | Files Affected |
|----------|-------|---------------|
| 🗑️ DELETE dead functions | ~760 | 10 files (includes 5 narrative-skeleton dead functions) |
| 🗑️ DELETE barrel exports | — | 8 files (21 exports) |
| 🗑️ DELETE unused imports | 14 | 11 files |
| 🗑️ DELETE BranchManager | ~350 | 1 file + orchestrator cleanup |
| **Subtotal: deletable** | **~1,124** | |
| 🔌 IMPLEMENT observability wiring | ~80 | 2 files |
| 🔌 IMPLEMENT CLI commands | ~50 | 1 file |
| 🔧 REFACTOR visual pipeline | ~400 | 3 files |
| 🔧 REFACTOR validation pipeline | ~200 | 2 files |
| 🔧 REFACTOR resolveVisualSpec extraction | ~200 | 2 files |
| 🔗 INTEGRATE world→prompts | ~30 | 1 file |
| 🔗 INTEGRATE learning bridge | ~20 | 1 file |
| 🔗 INTEGRATE motif→graph | ~10 | 1 file |
| 🔗 INTEGRATE inertia→chaos | ~10 | 1 file |
| 🔗 INTEGRATE remaining | ~40 | 2 files |
| **Subtotal: implementable** | **~1,040** | |

---

## Recommended Execution Order

### Phase 1 — Delete dead code (zero risk, ~1,094 lines)
1. Delete `branch-manager.ts` entirely + remove import/instance from orchestrator
2. Delete 20 dead functions from visual-translator.ts, command-parser.ts, continuity-analyzer.ts, narrative-skeleton.ts, character-lifecycle.ts, end-game-detection.ts, motif-tracker.ts, relationship-inertia.ts
3. Remove 21 barrel exports from index.ts
4. Remove 14 unused imports across 11 files
5. Remove 7 unused singletons

### Phase 2 — Wire observability (critical, ~80 lines)
6. Implement 5 TODOs in observability.ts
7. Call `collectMetrics()` in orchestrator after each chapter
8. Add timing tracking around story generation
9. Add CLI `/health` command

### Phase 3 — Unify visual pipeline (architectural cleanup, ~400 lines)
10. Merge `translateStoryToPanels()` logic into visual-orchestrator.ts
11. Delete the three dead visual-translator functions
12. Extract `resolveVisualSpec()` strategy layers into visual-prompt-engineer

### Phase 4 — Integrate missing wires (~110 lines)
13. Wire procedural-world data into story prompts
14. Wire learning bridge Phase 1 (sync patterns to vector store)
15. Wire motif-tracker → knowledge graph
16. Wire relationship-inertia → chaos events
17. Wire narrative-skeleton functions into orchestrator
18. Wire rateLimit into llm-wrapper

### Phase 5 — Decide on validation pipeline (~200 lines)
19. Integrate *WithContext functions OR delete them

### Phase 6 — Add CLI commands (~50 lines)
20. `/completion` — story completion progress
21. `/hooks` — current plot hooks
