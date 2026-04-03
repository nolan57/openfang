# Novel Engine Code Audit Report

**Date:** 2026-04-03
**Scope:** All 35+ files in `packages/opencode/src/novel/`
**Method:** Data flow analysis, call chain tracing, import/export mapping, database read/write symmetry analysis
**Status:** Complete

---

## Executive Summary

The novel engine at `packages/opencode/src/novel/` is a **completely closed subsystem** -- no exports are imported by any code outside the `novel/` directory. If the entire `novel/` folder were deleted, no other part of the codebase would break.

The audit identified:

| Category | Count | Total Lines |
|----------|-------|-------------|
| Fully dead files (never imported) | 6 | ~3,456 lines |
| Partially used files (some methods dead) | 8 | ~3,200 lines |
| Fully active files | 11 | ~3,500 lines |
| Dead methods within active files | 25+ methods | ~500 lines |
| Unused database columns | 1 (embeddings) | -- |

---

## 1. Fully Dead Files (Never Instantiated or Called)

### 1.1 `pattern-miner.ts`

| Attribute | Detail |
|-----------|--------|
| Lines | ~400 |
| Exported Symbols | `PatternMiner`, `analyzeAndEvolve`, `loadDynamicPatterns` |
| Importers | **None** (standalone `analyzeAndEvolve` and `loadDynamicPatterns` ARE called from orchestrator, but they are also duplicated within orchestrator.ts itself at lines 2262-2365) |
| Deprecation | File header contains deprecation warning pointing to `pattern-miner-enhanced.ts` |
| Verdict | **DEAD CODE** -- entire file can be deleted. `pattern-miner-enhanced.ts` is the replacement. |

**Recommendation:** Delete the file. The orchestrator's inline pattern functions can be replaced by calling `pattern-miner-enhanced.ts` directly.

---

### 1.2 `procedural-world.ts`

| Attribute | Detail |
|-----------|--------|
| Lines | ~496 |
| Exported Symbols | `ProceduralWorldGenerator`, `proceduralWorldGenerator` |
| Importers | **None** -- not exported from `index.ts` |
| Features | Procedural world generation with regions, history, conflicts, factions, resources, dangers |
| Verdict | **DEAD CODE** -- entire procedural world system was never integrated. |

**Methods defined but never called:**
- `generateWorld()`, `generateRegion()`, `generateHistory()`, `generateConflicts()`
- `getRegion()`, `getRegionByName()`, `getAllRegions()`, `getRegionsByType()`
- `discoverRegion()`, `addFactionToRegion()`, `getWorldSummary()`
- `exportToJson()`, `importFromJson()`
- `generateRegionResources()`, `generateRegionDangers()`, `generateRegionConnections()`

**Recommendation:** If procedural world generation is a planned future feature, keep it. Otherwise delete ~496 lines.

---

### 1.3 `multiway-relationships.ts`

| Attribute | Detail |
|-----------|--------|
| Lines | ~660 |
| Exported Symbols | `MultiWayRelationshipManager`, `multiWayRelationshipManager` |
| Importers | **None** -- not exported from `index.ts` |
| Features | Triad/group relationship detection (A-B-C dynamics, not just A-B pairs) |
| Verdict | **DEAD CODE** -- multi-way relationship detection was never integrated. |

**Methods defined but never called:**
- `analyzeTriad()`, `getAllTriads()`, `detectTriadInstability()`
- `analyzeGroupDynamics()`, `getPowerStructure()`, `detectSubgroups()`
- `generateTriadNarrativeHooks()`, `getTriadReport()`

**Recommendation:** Triad detection is a sophisticated feature. If not planned for near-term use, delete ~660 lines.

---

### 1.4 `performance.ts`

| Attribute | Detail |
|-----------|--------|
| Lines | ~500 |
| Exported Symbols | `memoize`, `clearMemoCache`, `deleteMemoKey`, `getMemoStats`, `rateLimit`, `debounce`, `throttle`, `batch`, `lazy`, `correlationId` |
| Importers | **None** from outside the file. The test file imports some utilities, but the production code never uses them. |
| Features | Caching, rate limiting, debouncing, throttling, batching, lazy initialization, correlation IDs |
| Verdict | **DEAD CODE** -- entire utility module is unused in production. Tests exercise the functions but no real code calls them. |

**Recommendation:** These are general-purpose utilities. Consider moving to a shared `util/` package if they might be used elsewhere. Otherwise delete ~500 lines.

---

### 1.5 `improvement-scheduler.ts`

| Attribute | Detail |
|-----------|--------|
| Lines | ~200 |
| Exported Symbols | `NovelImprovementScheduler`, `createImprovementScheduler` |
| Importers | **None** |
| Features | Periodic self-improvement scheduler with cron-like scheduling |
| Default State | `enabled: false` |
| Verdict | **DEAD CODE** -- scheduler is never started. `startScheduler()` is never called. |

**Recommendation:** If periodic self-improvement is a planned feature, wire it into the orchestrator lifecycle. Otherwise delete ~200 lines.

---

### 1.6 `multi-thread-narrative.ts` (Entire Class)

| Attribute | Detail |
|-----------|--------|
| Lines | ~1,200 |
| Exported Symbols | `MultiThreadNarrativeExecutor`, `multiThreadNarrativeExecutor`, `LLMClient`, `ReconciliationPlan`, `SemanticConflict` |
| Importers | **None** from outside the file. The test file (`phase5.test.ts`) imports and tests it, but **no production code instantiates it**. |
| Features | LLM-powered semantic conflict detection, circuit breaker, deduplication cache, intelligent arbitration |
| Verdict | **CODE COMPLETE BUT CALL CHAIN BROKEN** -- the class is fully implemented with all three upgrades (semantic detection, arbitration, circuit breaker), but `MultiThreadNarrativeExecutor` is **never instantiated in the orchestrator or any production code**. |

**The entire class is dormant:**
- `createThread()`, `advanceThread()`, `synchronizeThread()` -- never called
- `detectConflicts()` -- never called
- `resolveConflicts()`, `arbitrateConflict()` -- never called
- `getCircuitBreakerStatus()`, `resetCircuitBreaker()` -- never called
- `mergeThreads()`, `getActiveThreads()`, `getThreadReport()` -- never called

**Recommendation:** This is the most significant integration gap. The multi-thread executor should be instantiated in the orchestrator's `initializeAdvancedModules()` and called during the synchronization phase. Without this, ~1,200 lines of sophisticated conflict resolution code serves no purpose.

---

## 2. Partially Used Files (Active Core, Dead Methods)

### 2.1 `orchestrator.ts`

**Status:** Core of the entire novel engine. Most methods are active.

| Method | Approximate Line | Status | Verdict |
|--------|-----------------|--------|---------|
| `parsePromptSimple()` | ~1520 | Never called; replaced by `parsePromptWithLLM()` | **Dead code**, safe to remove |
| `selectBestBranch()` (non-LLM) | ~920 | Shadowed by `selectBestBranchLLM()`; never called | **Dead code**, safe to remove |
| `generateBranchStory()` | ~770 | Never called -- branch generation uses inline LLM in `generateBranches()` | **Dead code**, safe to remove |
| `analyzeAndSuggestImprovements()` | ~340 | Public method, **never called from outside** | Useful for future CLI command |
| `applyImprovement()` | ~370 | Public method, **never called from outside** | Useful for future CLI command |
| `switchBranch()` | ~940 | Public method, **never called from outside** | Useful for time-travel feature |
| `getAvailableBranches()` | ~955 | Public method, **never called from outside** | Useful for debugging UI |
| `dispose()` | ~2210 | **Never called** -- process exit doesn't invoke it | Should be wired to process `exit` handler |

**Lines at risk:** ~200 lines of dead methods

---

### 2.2 `story-knowledge-graph.ts`

**Status:** Actively used by `buildGraphConstraintContext()` in orchestrator.

| Method | Status | Verdict |
|--------|--------|---------|
| `findNodeByName()` | **Called** from `buildGraphConstraintContext` | Active |
| `wasCharacterActiveAtChapter()` | **Called** from `buildGraphConstraintContext` | Active |
| `getLocationStatusAtChapter()` | **Called** from `buildGraphConstraintContext` | Active |
| `detectInconsistency()` | **Called** from `buildGraphConstraintContext` | Active |
| `ingestFromMemoryEntry()` | **Called** via `queueMicrotask` in story-world-memory | Active |
| `addNode()` / `addCharacter()` / `addLocation()` / `addItem()` / `addEvent()` | **Called** from orchestrator post-generation | Active |
| `addEdge()` / `connectCharacterToLocation()` / `connectCharacterToFaction()` / `connectCharacters()` | **Called** internally | Active |
| `getNode()` | **Called** from location resolution | Active |
| `getNodesByType()` | **Called** from `buildGraphConstraintContext` | Active |
| `getEdgesForNode()` | **Called** from relationship queries | Active |
| `getNeighbors()` | **Called** internally | Active |
| `queryCharactersAtLocation()` | **Never called** | Useful for location-based scene filtering |
| `queryCharacterRelationships()` | **Called** from `buildGraphConstraintContext` (protagonist only) | Active but limited scope |
| `updateNodeStatus()` | **Called** from orchestrator post-generation | Active |
| `strengthenEdge()` | **Never called** | Useful for relationship intensity over time |
| `getStats()` | **Never called** | Useful for observability/debugging |
| `exportToJson()` / `importFromJson()` | **Never called** | Useful for save/load story state |
| `clear()` | **Never called** | Useful for testing/reset |

**Database write/read symmetry:** All writes have corresponding reads. `strengthenEdge()` writes but is never called.

**Lines at risk:** ~100 lines of unused query methods

---

### 2.3 `story-world-memory.ts`

**Status:** Actively used via `storeChapterSummary()` and `getMemoriesByLevel/Chapter/Character()`.

| Method | Status | Verdict |
|--------|--------|---------|
| `storeMemory()` | **Called** internally by all store methods | Active |
| `storeChapterSummary()` | **Called** from orchestrator post-generation | Active |
| `getMemoriesByLevel()` | **Called** from `buildMemoryContext` | Active |
| `getMemoriesByChapter()` | **Called** from `buildMemoryContext` | Active |
| `getMemoriesByCharacter()` | **Called** from `buildMemoryContext` | Active |
| `enforceMaxMemories()` | **Called** internally by `storeMemory()` | Active (pruning) |
| `storeSceneSummary()` | **Never called** | Useful for scene-level granularity |
| `storeArcSummary()` | **Never called** | Useful for arc-level summaries |
| `updateMemorySignificance()` | **Never called** | Useful for dynamic importance adjustment |
| `deleteMemory()` | **Never called** | Useful for cleanup |
| `getMemoriesByTheme()` | **Never called** | Useful for thematic queries |
| `getMemoryHierarchy()` | **Never called** | Useful for structured access |
| `getRecentContext()` | **Never called** | Useful but superseded by `buildMemoryContext()` |
| `getStats()` | **Called** from test only | Useful for observability |
| `exportToJson()` / `importFromJson()` | **Never called** | Useful for save/load |
| `clear()` | **Called** from test only | Useful for testing |

**Database column issue:** `embeddings` column is always `null` -- the `enableEmbeddings` config option is `false` by default and no code populates this column. If vector search is not planned, the column should be removed from the schema.

**Lines at risk:** ~200 lines of unused storage/query methods

---

### 2.4 `character-deepener.ts`

**Status:** **CRITICAL GAP** -- initialized but core analysis never called.

| Method | Status | Verdict |
|--------|--------|---------|
| `updateConfig()` | **Called** from orchestrator initialization | Active |
| `deepenCharacter()` | **Never called in main cycle** | **CRITICAL**: The core psychology analysis is never triggered |
| `deepenAllCharacters()` | **Never called** | **CRITICAL**: Batch analysis never triggered |
| `deepenCharacterFromLifecycle()` | **Never called** | Useful for lifecycle integration |
| `crossCharacterAnalysis()` | **Called** internally by `deepenAllCharacters()` | Dead along with parent |
| `generateDeepeningReport()` | **Never called** | Useful for debugging/reporting |

**Analysis:** The orchestrator calls `initializeCharacterDeepener()` which loads skill and trauma definitions, then calls `updateConfig()`. But `deepenCharacter()` -- the method that actually performs Big Five personality analysis, attachment style detection, core fear/desire identification, and character arc phase detection -- is **never invoked during the story generation cycle**.

This means the 556-line `character-deepener.ts` module loads configuration data but never produces any psychological profiles. The system prepares for character psychology but never analyzes any character.

**Lines at risk:** ~400 lines of psychology analysis that never runs

---

### 2.5 `motif-tracker.ts`

**Status:** Core tracking active, reporting dead.

| Method | Status | Verdict |
|--------|--------|---------|
| `analyzeMotifEvolution()` | **Called** from orchestrator | Active |
| `trackMotif()` | **Called** internally | Active |
| `getMotifForTheme()` | **Called** from narrative skeleton | Active |
| `exportToKnowledgeGraph()` | **Never called** | Useful for knowledge graph integration |
| `getMotifEvolutionReport()` | **Never called** | Useful for debugging/reporting |
| `getStats()` | **Never called** | Useful for observability |
| `generateThematicDeepeningSuggestion()` | **Never called** | Useful for thematic guidance |
| `calculateThematicSaturation()` | **Never called** | Useful for saturation metrics |

**Lines at risk:** ~150 lines of reporting/query methods

---

### 2.6 `character-lifecycle.ts`

**Status:** Minimally integrated -- only basic registration.

| Method | Status | Verdict |
|--------|--------|---------|
| `registerCharacter()` | **Called** from orchestrator | Active |
| `getLifecycle()` | **Called** from orchestrator | Active |
| `setCurrentChapter()` | **Called** from orchestrator | Active |
| `recordDeath()` | **Called** from orchestrator | Active |
| `advanceTime()` | **Never called** | Useful for aging characters over time |
| `recordLegacy()` | **Never called** | Useful for character legacy tracking |
| `generateNewCharacter()` | **Never called** | Useful for procedural generation |
| `getLifecycleReport()` | **Never called** | Useful for debugging |
| `getCharactersByLifeStage()` | **Never called** | Useful for life stage queries |
| `getCharactersByStatus()` | **Never called** | Useful for status queries |
| `exportToJson()` / `importFromJson()` | **Never called** | Useful for save/load |

**Persistence issue:** The lifecycle system is **in-memory only** -- no persistence to disk or database. If the process restarts, all lifecycle data is lost.

**Lines at risk:** ~200 lines of unused lifecycle methods

---

### 2.7 `end-game-detection.ts`

**Status:** Basic detection active, advanced features dead.

| Method | Status | Verdict |
|--------|--------|---------|
| `updateStoryMetrics()` | **Called** from orchestrator | Active |
| `checkCompletion()` | **Called** from orchestrator | Active |
| `addCriterion()` | **Never called** | Useful for custom completion criteria |
| `updateCriterion()` | **Never called** | Useful for criterion updates |
| `generateDenouementStructure()` | **Never called** | Useful for ending structure planning |
| `getCriterionProgress()` | **Never called** | Useful for progress tracking |
| `getMetaLearner()` / `setMetaLearner()` | **Never called** | Useful for meta-learning integration |
| `exportToJson()` / `importFromJson()` | **Never called** | Useful for save/load |
| `createEndGameDetector()` | Factory function, never called | **Dead** |

**Finding:** The detector uses **default criteria only** -- no custom criteria are ever added based on the story's skeleton, themes, or character arcs.

**Lines at risk:** ~150 lines of advanced detection methods

---

### 2.8 `relationship-inertia.ts`

**Status:** Initialization active, hook consumption dead.

| Method | Status | Verdict |
|--------|--------|---------|
| `initializeRelationship()` | **Called** from orchestrator | Active |
| `getInertia()` | **Called** from orchestrator | Active |
| `generatePlotHooks()` | **Called** from orchestrator | Active (but hooks are never consumed) |
| `decayResistance()` | **Never called** | Should be called periodically to model relationship decay |
| `triggerHook()` | **Never called** | **CRITICAL**: Plot hooks are generated but never triggered |
| `getActiveHooks()` / `getTriggeredHooks()` | **Never called** | Useful for hook management |
| `getHooksForCharacters()` | **Never called** | Useful for character-specific hooks |
| `getPlotHooksReport()` | **Never called** | Useful for debugging |

**Critical gap:** `generatePlotHooks()` produces hooks like "Alice owes Bob a favor -- this could create tension when Bob needs help" but these hooks are **never consumed by the story generation**. They go into a void. The relationship inertia system generates narrative fuel but the engine never burns it.

**Persistence issue:** In-memory only, no persistence.

**Lines at risk:** ~200 lines of hook management methods

---

## 3. LLM callType Audit

All `callType` strings used across the novel engine:

| callType | File | Active? | Notes |
|----------|------|---------|-------|
| `branch_generation` | orchestrator.ts | ✅ Active | Branch generation prompt |
| `branch_selection` | orchestrator.ts | ✅ Active | Branch selection with reasoning |
| `branch_story_generation` | orchestrator.ts | ✅ Active | Individual branch story text |
| `branch_evaluation` | orchestrator.ts | ✅ Active | Branch quality evaluation |
| `chapter_summary` | orchestrator.ts | ✅ Active | Post-generation summary (new) |
| `prompt_parsing` | orchestrator.ts | ✅ Active | Initial prompt parsing |
| `story_generation` | orchestrator.ts | ✅ Active | Main story generation |
| `epic_summary` | orchestrator.ts | ✅ Active | Compressed memory summary (new) |
| `chapter_title_extraction` | orchestrator.ts | ✅ Active | Chapter title generation |
| `character_extraction` | orchestrator.ts | ✅ Active | Character extraction from story |
| `pattern_analysis` | orchestrator.ts | ✅ Active | Pattern mining |
| `skill_generation_check` | orchestrator.ts | ✅ Active | Skill generation check |
| `thread_event_conflict` | multi-thread-narrative.ts | ⚠️ Defined, not triggered | Module not instantiated |
| `thread_summary_conflict` | multi-thread-narrative.ts | ⚠️ Defined, not triggered | Module not instantiated |
| `thread_arbitration` | multi-thread-narrative.ts | ⚠️ Defined, not triggered | Module not instantiated |

**All callTypes are unique and traceable.** No duplicates found. The three `thread_*` types are properly defined but their module is never instantiated.

---

## 4. Database Write/Read Symmetry Analysis

### 4.1 `story-memory.db` (memory_entries table)

| Write Operation | Read Operation | Symmetric? | Notes |
|----------------|----------------|------------|-------|
| `storeMemory()` INSERT | `getMemoriesByLevel()`, `getMemoriesByChapter()`, `getMemoriesByCharacter()` | ✅ Yes | All reads operational |
| `enforceMaxMemories()` DELETE | N/A (pruning) | ✅ Yes | Correct pruning logic |
| `updateMemorySignificance()` UPDATE | **Never called** | ❌ No | Method defined but never invoked |
| `deleteMemory()` DELETE | **Never called** | ❌ No | Method defined but never invoked |
| `embeddings` column | **Always null** | ❌ No | Column exists but never populated |

**Schema issue:** The `embeddings TEXT` column is defined in the table but always set to `null`. The `enableEmbeddings` config option defaults to `false` and no code path populates this field.

### 4.2 `story-graph.db` (nodes, edges tables)

| Write Operation | Read Operation | Symmetric? | Notes |
|----------------|----------------|------------|-------|
| `addNode()` INSERT | `getNode()`, `getNodesByType()`, `findNodeByName()` | ✅ Yes | All reads operational |
| `addEdge()` INSERT | `getEdgesForNode()`, `getNeighbors()` | ✅ Yes | All reads operational |
| `updateNodeStatus()` UPDATE | `wasCharacterActiveAtChapter()` | ✅ Yes | Status check reads the updated field |
| `strengthenEdge()` UPDATE | **Never called** | ❌ No | Method defined but never invoked |
| `clear()` DELETE | N/A (reset) | ✅ Yes | Correct reset logic |

### 4.3 `branches.db` (branch_storage table)

| Write Operation | Read Operation | Symmetric? | Notes |
|----------------|----------------|------------|-------|
| `saveBranch()` INSERT/UPDATE | `getBranchById()`, `getBranchesByChapter()`, `getSelectedBranch()` | ✅ Yes | All reads operational |
| `updateBranch()` UPDATE | Same reads as above | ✅ Yes | Operational |
| `deleteBranch()` DELETE | N/A (pruning) | ✅ Yes | Correct pruning logic |

### 4.4 In-Memory Only Systems (No Persistence)

| System | Persistence? | Risk |
|--------|-------------|------|
| `character-lifecycle.ts` | ❌ In-memory only | Data lost on restart |
| `faction-detector.ts` | ❌ In-memory only | Faction data lost on restart |
| `relationship-inertia.ts` | ❌ In-memory only | Plot hooks lost on restart |
| `multiway-relationships.ts` | ❌ In-memory only | Triad data lost on restart |
| `pattern-miner-enhanced.ts` | ✅ Saves/loads JSON | Persistence OK |
| `motif-tracker.ts` | ✅ Saves/loads JSON | Persistence OK |

---

## 5. External Import Analysis

**Finding: Zero novel/ exports are imported outside the `novel/` directory.**

The only references to `novel/` modules from outside the directory are:
- Documentation files (`docs/WEB_PROPOSAL.md`, `docs/NOVEL_EVOLVE_INTEGRATION.md`)
- Internal imports within `novel/` itself

This confirms the novel engine is a **fully isolated subsystem**. It can be developed, tested, and even removed without affecting any other part of the codebase.

---

## 6. Summary: Dead Code Inventory

### 6.1 Fully Removable Files (HIGH confidence)

| File | Lines | Reason |
|------|-------|--------|
| `pattern-miner.ts` | ~400 | Deprecated, replaced by `pattern-miner-enhanced.ts` |
| `procedural-world.ts` | ~496 | Never imported, never instantiated |
| `multiway-relationships.ts` | ~660 | Never imported, never instantiated |
| `performance.ts` | ~500 | Never imported in production code |
| `improvement-scheduler.ts` | ~200 | Never started, `enabled: false` default |
| **Total** | **~2,256 lines** | |

### 6.2 Dead Methods Within Active Files

| File | Methods | Lines | Reason |
|------|---------|-------|--------|
| `orchestrator.ts` | `parsePromptSimple()`, `selectBestBranch()`, `generateBranchStory()` | ~100 | Replaced by newer versions |
| `story-knowledge-graph.ts` | `strengthenEdge()` | ~10 | Never called |
| `story-world-memory.ts` | `storeSceneSummary()`, `storeArcSummary()`, `updateMemorySignificance()`, `deleteMemory()`, `getMemoriesByTheme()`, `getMemoryHierarchy()`, `getRecentContext()` | ~150 | Never called from production code |
| `character-deepener.ts` | `deepenCharacter()`, `deepenAllCharacters()` (core methods) | ~400 | **Never called in main cycle** |
| `motif-tracker.ts` | `exportToKnowledgeGraph()`, `getMotifEvolutionReport()`, `getStats()` | ~100 | Reporting methods never called |
| `character-lifecycle.ts` | `advanceTime()`, `recordLegacy()`, `generateNewCharacter()` | ~150 | Time progression never activated |
| `end-game-detection.ts` | `addCriterion()`, `generateDenouementStructure()`, `getCriterionProgress()` | ~100 | Advanced detection never used |
| `relationship-inertia.ts` | `decayResistance()`, `triggerHook()`, `getActiveHooks()` | ~100 | Hook consumption never activated |
| `multi-thread-narrative.ts` | **Entire class** (all methods) | ~1,200 | **Never instantiated** |
| **Total** | | **~2,300+ lines** | |

### 6.3 Dormant but Potentially Useful

| Component | What's Missing | Effort to Activate | Impact |
|-----------|---------------|-------------------|--------|
| `character-deepener.ts` | `deepenCharacter()` never called in main cycle | **Low** -- add 1 call after state extraction | High -- 556 lines of psychology analysis becomes active |
| `relationship-inertia.ts` | `triggerHook()` never consumes generated plot hooks | **Medium** -- wire hook consumption into branch generation | High -- plot hooks drive narrative surprises |
| `pattern-miner-enhanced.ts` | Not wired into orchestrator | **Medium** -- replace deprecated `pattern-miner.ts` | High -- enhanced pattern detection with archetypes |
| `character-lifecycle.ts` | Only basic registration, no aging or life events | **Medium** -- add aging logic and life event generation | Medium -- characters age and evolve over time |
| `end-game-detection.ts` | No custom criteria added | **Low** -- add criteria based on skeleton/themes | Medium -- story endings become more structured |
| `story-world-memory.ts` | Scene/arc summaries never stored | **Low** -- add calls at appropriate generation points | Medium -- finer-grained memory hierarchy |
| `novel-learning-bridge.ts` | Improvement analysis never triggered | **Medium** -- add CLI command or periodic trigger | Medium -- self-improvement system activates |
| `multi-thread-narrative.ts` | **Never instantiated** | **High** -- integrate into orchestrator's multi-thread flow | Very High -- 1,200 lines of conflict resolution activates |

---

## 7. Priority Recommendations

### P0 -- Critical (Activate or Remove)

| Action | Target | Lines Affected | Rationale |
|--------|--------|---------------|-----------|
| Activate `deepenCharacter()` call in main cycle | `orchestrator.ts` + `character-deepener.ts` | ~556 lines activated | Psychology analysis is the most unique feature of this engine; not using it wastes the core value proposition |
| Remove `parsePromptSimple()`, `selectBestBranch()`, `generateBranchStory()` | `orchestrator.ts` | ~100 lines removed | Dead methods replaced by newer versions |
| Delete `pattern-miner.ts` | Entire file | ~400 lines removed | Deprecated, duplicated functionality |

### P1 -- High (Integrate or Remove)

| Action | Target | Lines Affected | Rationale |
|--------|--------|---------------|-----------|
| Integrate `MultiThreadNarrativeExecutor` into orchestrator | `orchestrator.ts` + `multi-thread-narrative.ts` | ~1,200 lines activated | Most sophisticated conflict resolution system in the engine; currently 100% dormant |
| Activate `triggerHook()` for plot hook consumption | `orchestrator.ts` + `relationship-inertia.ts` | ~300 lines activated | Plot hooks generated but never consumed -- wasted narrative fuel |
| Delete `procedural-world.ts`, `multiway-relationships.ts`, `performance.ts`, `improvement-scheduler.ts` | 4 files | ~1,856 lines removed | Never imported, no integration path planned |

### P2 -- Medium (Clean Up)

| Action | Target | Lines Affected | Rationale |
|--------|--------|---------------|-----------|
| Remove `embeddings` column or implement vector search | `story-world-memory.ts` schema | Schema cleanup | Column always null, confusing for future developers |
| Wire `pattern-miner-enhanced.ts` into orchestrator | `orchestrator.ts` | ~704 lines activated | Replacement for deprecated pattern-miner |
| Add persistence to in-memory systems | lifecycle, faction, inertia modules | New code needed | Data lost on restart |
| Remove `strengthenEdge()` or implement edge strengthening | `story-knowledge-graph.ts` | ~10 lines removed/activated | Method defined but never called |

### P3 -- Low (Documentation and Observability)

| Action | Target | Lines Affected | Rationale |
|--------|--------|---------------|-----------|
| Wire `dispose()` to process exit handler | `orchestrator.ts` | ~5 lines added | Cleanup on process exit |
| Activate `getCircuitBreakerStatus()` for observability | orchestrator or monitoring | ~5 lines added | Circuit breaker status visibility |
| Clean up unused reporting methods or build CLI commands | Various | ~350 lines affected | Dead reporting methods or unused CLI commands |

---

## 8. Architecture Risk Assessment

| Risk | Severity | Description |
|------|----------|-------------|
| **Multi-thread executor never used** | HIGH | 1,200 lines of LLM-powered conflict resolution code serves zero purpose. If this feature is planned, it needs integration. If not, it's 1,200 lines of maintenance burden. |
| **Character psychology never analyzed** | HIGH | The character deepener loads configuration but never produces profiles. The engine claims "character psychology deepening" as a core feature but it's never triggered. |
| **Plot hooks generated but never consumed** | MEDIUM | Relationship inertia generates narrative hooks that go into a void. This wastes the relationship-driven narrative potential. |
| **Dead code inflates codebase** | MEDIUM | ~4,500 lines of dead or dormant code across 10 files. Increases cognitive load, slows onboarding, risks bugs in unused code paths. |
| **No persistence for in-memory systems** | MEDIUM | Character lifecycle, faction, and relationship inertia data is lost on process restart. |
| **Embeddings column always null** | LOW | Confusing for future developers. Either implement vector search or remove the column. |

---

## 9. Integration Dependency Graph

```
orchestrator.ts (ROOT)
    │
    ├── state-extractor.ts          ✅ Active
    ├── evolution-rules.ts          ✅ Active
    ├── character-deepener.ts       ⚠️ Config loaded, analysis NEVER called
    ├── relationship-analyzer.ts    ✅ Active (in generateBranches)
    ├── narrative-skeleton.ts       ✅ Active
    ├── thematic-analyst.ts         ✅ Active
    ├── pattern-miner.ts            ❌ DEPRECATED (replaced by enhanced)
    ├── pattern-miner-enhanced.ts   ❌ NEVER WIRED into orchestrator
    ├── story-world-memory.ts       ✅ Active (chapter summaries only)
    ├── story-knowledge-graph.ts    ✅ Active (protagonist only)
    ├── branch-manager.ts           ✅ Active (when useBranches=true)
    ├── branch-storage.ts           ✅ Active (when useBranches=true)
    ├── motif-tracker.ts            ✅ Active (core), ⚠️ reporting dead
    ├── character-lifecycle.ts      ⚠️ Registration only, no aging
    ├── end-game-detection.ts       ✅ Basic, ⚠️ advanced features dead
    ├── faction-detector.ts         ✅ Active
    ├── relationship-inertia.ts     ⚠️ Hooks generated, NEVER consumed
    ├── continuity-analyzer.ts      ✅ Active (visual flow)
    ├── visual-orchestrator.ts      ✅ Active
    ├── visual-prompt-engineer.ts   ✅ Active
    ├── visual-translator.ts        ✅ Active
    ├── novel-learning-bridge.ts    ⚠️ Initialized, improvement NEVER triggered
    ├── multi-thread-narrative.ts   ❌ NEVER INSTANTIATED
    ├── procedural-world.ts         ❌ NEVER IMPORTED
    ├── multiway-relationships.ts   ❌ NEVER IMPORTED
    ├── performance.ts              ❌ NEVER IMPORTED
    ├── improvement-scheduler.ts    ❌ NEVER STARTED
    └── observability.ts            ⚠️ Defined, metrics NEVER recorded
```

---

## 10. Conclusion

The novel engine has a **bimodal architecture**: a well-integrated core (orchestrator + state extraction + chaos system + visual panels) surrounded by a large periphery of sophisticated but dormant subsystems.

**The most significant gap:** `MultiThreadNarrativeExecutor` (~1,200 lines with circuit breaker, semantic cache, LLM arbitration) and `CharacterDeepener` (~556 lines with Big Five, Attachment Theory, Character Arc analysis) are both fully implemented but never called in the main generation cycle. These two modules represent the engine's most distinctive features and together account for ~1,756 lines of code that currently serves no purpose.

**Total dead/dormant code:** ~4,500 lines across ~10 files and ~25 methods.

---

**Audit Date:** 2026-04-03
**Auditor:** AI Code Analysis
**Branch:** linux
**Commit:** af407f689
