# Novel Engine - Dead Code Strategic Analysis

**Date:** 2026-04-05
**Last Updated:** 2026-04-07 — Phase 1/2 cleanup completed
**Perspective:** Novel engine purpose — AI-driven interactive fiction with dynamic branching, character psychology, relationship dynamics, and visual panel generation
**Method:** Each dead code item evaluated against engine goals, then classified into: **保留/Keep**, **实现/Implement**, **重构/Refactor**, **集成/Integrate**, **删除/Delete**

---

## Status Update (2026-04-07)

Commit `ad8b2747d` and follow-up cleanup have completed:

| Item | Status |
|------|--------|
| ~~`enrichBeatWithVisuals()`~~ | ✅ **DELETED** |
| ~~`translateStoryToPanels()`~~ | ✅ **DELETED** |
| ~~`ruleBasedPreSegmentation()`~~ | ✅ **MOVED** to `visual-orchestrator.ts` |
| ~~`initVisualTranslator()`~~ | ✅ **DELETED** |
| ~~`generateDeterministicVisualHash()`~~ export | ✅ **MADE INTERNAL** |
| ~~`EnrichedBeat`~~ re-export | ✅ **REMOVED** |
| Barrel exports: `isSlashCommand`, `listSkills`, `callLLMBatch`, `callLLMWithTracing`, `novelLLM` | ✅ **REMOVED** |

The visual pipeline unification is **complete**. `visual-translator.ts` is now a clean 732-line config-driven utility library with 100% active exports.

---

## Strategic Evaluation Framework

The novel engine's core purpose is:
1. **Interactive fiction generation** — LLM writes compelling, coherent stories
2. **Dynamic branching** — Multiple narrative paths, chaos-driven divergence
3. **Character psychology** — Big Five, Attachment Theory, trauma, skill growth
4. **Relationship dynamics** — Trust, hostility, factions, triads, plot hooks
5. **Visual panel generation** — Camera specs, lighting, prompts for image generation
6. **Self-evolution** — Pattern mining, thematic analysis, continuous improvement

Each dead code item is evaluated against these goals.

---

## Classification Legend

| Classification | Meaning | Action |
|---------------|---------|--------|
| **🟢 保留 KEEP** | Valuable for engine goals, keep as public API or future extension | No action needed, document intent |
| **🔵 实现 IMPLEMENT** | Partially built, design is sound, needs completion | Add missing logic, wire into pipeline |
| **🟣 重构 REFACTOR** | Has value but needs redesign before integration | Rewrite architecture, simplify, or merge |
| **🟡 集成 INTEGRATE** | Fully built, only missing wiring into orchestrator | Add calls in orchestrator, expose CLI |
| **🔴 删除 DELETE** | No alignment with engine goals, or superseded by better approach | Remove code and docs |

---

## 1. visual-translator.ts — ~~Dead Functions~~ — ✅ CLEANED UP

### ~~`initVisualTranslator()`~~ — ✅ DELETED
- **Status:** Removed in cleanup pass. Config loaded lazily via `getConfig()`.

### ~~`enrichBeatWithVisuals()`~~ — ✅ DELETED
- **Status:** Removed in cleanup pass. `assemblePanelSpec()` is the sole entry point.

### ~~`translateStoryToPanels()`~~ — ✅ DELETED
- **Status:** Removed in cleanup pass. Its `ruleBasedPreSegmentation()` logic was moved to `visual-orchestrator.ts` where it's actively used.

### `generateDeterministicVisualHash()` — ✅ MADE INTERNAL
- **Status:** No longer exported. Used only by `generateStableCharacterRefUrl()` internally.

### Current Active Exports (all verified)

| Export | Purpose | Consumer |
|--------|---------|----------|
| `assemblePanelSpec()` | Complete panel assembly | visual-prompt-engineer.ts |
| `translateEmotionToVisuals()` | Emotion → visual mapping | visual-prompt-engineer.ts |
| `translateActionToCamera()` | Action → camera mapping | visual-prompt-engineer.ts |
| `selectLightingPreset()` | Lighting presets | visual-prompt-engineer.ts |
| `selectStyleModifiers()` | Style modifiers | visual-prompt-engineer.ts |
| `selectAtmosphericEffects()` | Atmospheric effects | visual-prompt-engineer.ts |
| `generateStableCharacterRefUrl()` | Deterministic character ref | visual-prompt-engineer.ts |
| `prioritizeAndTruncatePrompt()` | Token-limited prompts | visual-prompt-engineer.ts (internal) |
| `getShotSpecificNegatives()` | Shot negative prompts | visual-translator.ts (internal) |
| `getMovementSpecificNegatives()` | Movement negative prompts | visual-translator.ts (internal) |
| `isComplexEmotion()` | Complex emotion check | visual-prompt-engineer.ts |
| `isComplexAction()` | Complex action check | visual-prompt-engineer.ts |

---

## 2. config/config-loader.ts — resolveVisualSpec Pipeline (814 lines)

### `resolveVisualSpec()` — 🟣 REFACTOR
- **What:** Core visual strategy resolver — takes `VisualContext` (tension, motifs, emotion, action) → resolves camera/lighting/composition/negative_prompts through a **layered override + thematic voting** system
- **Why dead:** `visual-prompt-engineer.ts` uses a simpler hardcoded + config hybrid. `resolveVisualSpec()` was designed for a more sophisticated visual strategy system that was never fully wired.
- **Engine value:** **MEDIUM-HIGH** — The design is genuinely sophisticated:
  - Dynamic weight calculation based on motif count and tension level
  - Thematic voting mechanism for multi-motif scenes
  - Strategy layer overrides (e.g., "when tension > 0.7, add dramatic lighting")
  - Conflict resolution for negative prompts
- **Problem:** The VisualContext interface and voting system add complexity that the current hybrid engine doesn't need. The hardcoded rules in `visual-prompt-engineer.ts` work adequately.
- **Action:** **Refactor, not delete:**
  1. Extract the **strategy layer override system** into `visual-prompt-engineer.ts` as an optional enhancement
  2. Extract the **dynamic weight calculation** for motif-influenced visuals
  3. Simplify the voting mechanism — it's over-engineered for current needs
  4. Keep `resolveVisualSpec()` as an advanced mode that can be enabled via config

### `reloadVisualConfig()` / `clearConfigCache()` — 🟢 KEEP
- **What:** Hot-reload and cache management for visual config
- **Why dead:** No runtime config changes during a story session.
- **Engine value:** **LOW but future-proof** — Useful for:
  - Live config updates without restarting the engine
  - Testing different visual styles mid-session
  - Plugin/hot-reload scenarios
- **Action:** Keep. Document as advanced/development utilities.

---

## 3. narrative-skeleton.ts — Standalone Functions (595 lines)

### `createNarrativeSkeleton()`, `loadNarrativeSkeleton()` — 🟢 KEEP
- **What:** LLM-based skeleton creation / file load
- **Why "dead":** Only called by `NarrativeSkeletonManager` class methods, not as standalone functions
- **Engine value:** **HIGH** — These are the core functions. The class is a thin wrapper. Keep as-is.

### `updateStoryLineProgress()`, `getNextKeyBeat()`, `getActiveStoryLines()`, `getThematicMotifString()`, `getOverallCompletionPercentage()`, `updateNarrativeSkeleton()` — 🟡 INTEGRATE
- **What:** Convenience functions for querying and updating the narrative skeleton
- **Why dead:** The orchestrator has its own direct access to `this.storyState.narrativeSkeleton` and doesn't use these helpers.
- **Engine value:** **MEDIUM** — These are useful query helpers that would improve code clarity:
  - `getNextKeyBeat()` — essential for knowing what beat to write next
  - `getActiveStoryLines()` — useful for multi-thread mode (already uses story lines)
  - `getThematicMotifString()` — already injected into prompts via `buildPatternContext()`
  - `getOverallCompletionPercentage()` — useful for end-game detection
- **Action:** Wire into orchestrator. Replace direct state access with these functions for better encapsulation.

### `createFallbackSkeleton()` — 🔴 DELETE
- **What:** Creates a boring 20-chapter "continue developing the story" skeleton when LLM fails
- **Why dead:** Internal function, never called. The orchestrator catches errors and continues without a skeleton.
- **Engine value:** **LOW** — The fallback is so generic it adds no value over no skeleton.
- **Action:** Delete. If LLM skeleton generation fails, log and continue without one (current behavior).

---

## 4. validation.ts — *WithContext Functions (592 lines)

### `validateGoalWithContext()`, `validateTraumaWithContext()`, `validateSkillWithContext()`, `validateCharacterUpdateWithContext()`, `validateRelationshipUpdateWithContext()` — 🟣 REFACTOR
- **What:** Context-aware validation functions that check updates against the full world state (not just schema validation)
- **Why dead:** The state extractor uses `validateRawStateUpdateWithWorldContext()` (a different function in the same file). The `*WithContext` functions were designed as a more granular validation API.
- **Engine value:** **MEDIUM** — These provide important validation that schema-only validation can't:
  - Checking if a trauma award makes sense given the character's existing trauma profile
  - Checking if a skill award is appropriate for the character's current capabilities
  - Checking if a goal change is consistent with the character's established motivations
- **Problem:** These functions validate against a "world context" object that would need to be constructed. The current `validateRawStateUpdateWithWorldContext()` does bulk validation in one call.
- **Action:** **Refactor into the state extractor's validation pipeline:**
  1. Call `validateCharacterUpdateWithContext()` for each character update in the batch
  2. Call `validateRelationshipUpdateWithContext()` for each relationship change
  3. This would provide better error messages and more targeted corrections
  4. Remove `createCorrelationId` / `createCorrelationContext` (test-only utilities)

### `createCorrelationId()`, `createCorrelationContext()` — 🔴 DELETE from barrel exports
- **What:** Correlation tracking for validation chains
- **Why dead:** Only used in tests
- **Action:** Remove from barrel exports. Keep in file for test use.

---

## 5. llm-wrapper.ts — Dead Exports (297 lines)

### `callLLMWithTracing()` — 🟡 INTEGRATE → observability.ts
- **What:** Wraps `callLLM()` with a tracing callback for observability
- **Why dead:** The observability system tracks generation times via `startGenerationTiming()` / `endGenerationTiming()` instead.
- **Engine value:** **MEDIUM** — This provides a cleaner API for LLM tracing than manual timing calls.
- **Action:** Wire into observability. Replace manual timing with this wrapper.

### `callLLMBatch()` — 🟢 KEEP
- **What:** Batch processing with concurrency control
- **Why "dead":** Only used in tests
- **Engine value:** **HIGH for future use** — Essential for:
  - Parallel character deepening (deepen all characters simultaneously)
  - Parallel relationship analysis
  - Pattern mining across multiple story segments
  - Visual panel generation for multiple beats
- **Action:** Keep as public API. Document use cases.

### `novelLLM` namespace — 🟢 KEEP
- **What:** Unified API object (`call`, `callJson`, `callWithTracing`, `batch`)
- **Why dead:** Never imported. Individual functions are used instead.
- **Engine value:** **LOW** — Convenient namespace but no one uses it.
- **Action:** Remove from barrel exports. Keep the namespace in file for convenience.

---

## 6. performance.ts — Dead Utilities (209 lines)

### `memoize()` — 🟢 KEEP (actively used internally)
- **Used by:** `pattern-miner-enhanced.ts` (planned), state extractor (potential)
- **Engine value:** **HIGH** — LLM calls are expensive. Caching identical prompts saves cost and time.

### `debounce()` — 🟢 KEEP (actively used)
- **Used by:** `orchestrator.ts` (debounced state saving)
- **Engine value:** **HIGH** — Prevents excessive I/O during rapid story generation.

### `rateLimit()`, `throttle()`, `batch()`, `lazy()` — 🟢 KEEP as public API
- **Why "dead":** Only used in tests
- **Engine value:** **HIGH for production use:**
  - `rateLimit()` — API rate limiting for LLM providers (critical)
  - `throttle()` — Control frequency of expensive operations (pattern mining, visual generation)
  - `batch()` — Batch multiple updates into one I/O operation
  - `lazy()` — Lazy initialization of expensive resources
- **Action:** Keep as public API. Wire into production:
  1. Apply `rateLimit()` to LLM calls in `llm-wrapper.ts`
  2. Apply `throttle()` to pattern mining (limit to once per 3 chapters)
  3. Apply `batch()` to state saving (batch every 500ms)

### `clearMemoCache()`, `deleteMemoKey()`, `getMemoStats()` — 🔴 DELETE from barrel exports
- **Why dead:** Only used in tests for cache management
- **Action:** Remove from barrel exports.

---

## 7. ~~branch-manager.ts~~ / branch-storage.ts — ~~Dead Exports~~ — **OUTDATED**

**⚠️ This section is from an older analysis. BranchManager is now FULLY INTEGRATED.**

### ~~Branch querying functions~~ — ✅ **NOW ACTIVE**
- `getEventsByBranchId()`, `getBranchTree()`, `getBranchPath()` all actively used via orchestrator APIs
- Available for CLI `/branches` command through orchestrator.getBranchTree()

### ~~`autoMergeSimilarBranches()`, `mergeBranches()`, `detectSimilarBranches()`~~ — ✅ **NOW ACTIVE**
- **ALREADY INTEGRATED** - autoMergeSimilarBranches() called in orchestrator.ts:1844
- Runs every chapter after branch generation
- Prevents branch explosion automatically

### Branch storage exports — 🟡 INTEGRATE (unchanged)
- `loadBranchesByEventType`, `loadBranchTree`, `exportToJson`, `importFromJson` — still useful for CLI export features
- **Action:** Wire into `/export branches` CLI command.

### `BranchEvent` type — 🔴 DELETE
- **Why dead:** Type defined but never instantiated anywhere
- **Action:** Delete. If branch events are needed, define them properly.

### Embedding column in branch-storage — 🔴 DELETE or 🔵 IMPLEMENT
- **What:** `embedding: text().notNull().default('')` column, `enableEmbeddings` config option
- **Engine value:** **MEDIUM** — Embeddings would enable:
  - Semantic branch search ("find branches similar to current situation")
  - Intelligent branch suggestion based on story context
- **Action:** **Decision point:**
  - If implementing: Use the OpenCode learning system's embedding model to generate branch embeddings
  - If deleting: Remove column, config option, and all embedding-related code
  - **Recommendation:** Delete for now. The vector store in `novel-learning-bridge.ts` provides pattern embeddings — branch embeddings are a lower priority.

---

## 8. observability.ts — TODOs and Dead Exports (435 lines)

### 5 TODOs with hardcoded zeros — 🔵 IMPLEMENT

| TODO | Impact | Implementation |
|------|--------|---------------|
| `factionCount: 0` | Faction metrics always zero | Call `asyncGroupService.getAllGroups()` in `collectMetrics()` |
| `totalMemories: 0` | Memory usage untracked | Call `storyWorldMemory.getStats()` |
| `inconsistencyCount: 0` | Graph consistency unmeasured | Call `storyKnowledgeGraph.detectInconsistency()` |
| `avgExtractionTime: 0` | State extraction performance unknown | Add timing in `stateExtractor.extract()` |
| `getCurrentChapter` returns `1` | Chapter tracking broken | Return `this.storyState.chapterCount` |

**Engine value:** **HIGH** — Without real metrics, the health report is meaningless. The `generateHealthReport()` function has sophisticated logic to detect problems, but it always operates on fake data.

**Action:** Implement all 5 TODOs. This transforms observability from a placeholder to a real monitoring system.

### `exportTraceData()`, `getErrorSummary()`, `getMetricsHistory()`, `getTraceEvents()` — 🟡 INTEGRATE
- **Why dead:** No consumers
- **Engine value:** **MEDIUM** — Useful for:
  - CLI `/health` command to show engine health
  - Debugging story generation issues
  - Performance profiling
- **Action:** Wire into CLI `/health` and `/metrics` commands.

### `getNovelLanguageModel`, `generateText` unused imports — 🔴 DELETE
- **Action:** Remove unused imports.

---

## 9. novel-learning-bridge.ts — Integration Status (666 lines)

### Current Status — 🟣 REFACTOR → Partial Integration
- **What:** Bridge between novel engine and OpenCode learning system (vector store, knowledge graph, memory critic, improvement API)
- **Wired:** `NovelLearningBridgeManager` is instantiated in orchestrator and initialized
- **Not Wired:** The actual data flow — patterns, memories, and knowledge graph nodes are NOT synced to the learning system
- **Engine value:** **HIGH** — This is the key to the "self-evolving" aspect:
  - Novel patterns → Learning system vector store → Similar pattern retrieval for future stories
  - Novel knowledge graph → Learning system knowledge graph → Cross-story learning
  - Novel memory → Learning system memory → Quality-filtered, deduplicated storage
  - Improvement API → Analyze novel engine code → Suggest improvements

**Current data flow:**
```
Novel Engine → Pattern Mining → Save to .opencode/novel/patterns/ → 🛑 END
```

**Intended data flow:**
```
Novel Engine → Pattern Mining → NovelVectorBridge → Learning System Vector Store
            → Memory Entries → Memory Bridge → Learning System Memory
            → Knowledge Graph → Knowledge Bridge → Learning System KG
            → Improvement API → Analyze & Suggest → Human Review → Apply
```

**Action:** **Phase the integration:**
1. **Phase 1 (P0):** Wire `NovelVectorBridge` — sync patterns to vector store after each `enhancedPatternMiner.onTurn()`
2. **Phase 2 (P1):** Wire memory bridge — filter high-salience memories and sync
3. **Phase 3 (P2):** Wire knowledge graph bridge — sync character/location/relationship nodes
4. **Phase 4 (P3):** Wire improvement API — analyze and suggest engine improvements

---

## 10. motif-tracker.ts, relationship-inertia.ts, end-game-detection.ts

### ~~`motifTracker.exportToKnowledgeGraph()`~~ — ✅ **ALREADY INTEGRATED**
- **ALREADY WIRED** - exportToKnowledgeGraph() called in orchestrator.ts:2140
- Nodes and edges synced to storyKnowledgeGraph after motif analysis
- Enables motif-character correlation queries

### `relationshipInertiaManager.getHooksForCharacters()`, `getPlotHooksReport()` — 🟡 INTEGRATE
- **Engine value:** **MEDIUM** — Plot hooks are the engine's way of suggesting narrative direction:
  - "Character A owes Character B a confrontation" (unresolved hostility)
  - "Characters C and D are growing close" (increasing trust)
  - These hooks should be visible in CLI `/hooks` command and optionally injected into chaos events
- **Action:** Wire into CLI and optionally into chaos event context.

### `endGameDetector.generateDenouementStructure()`, `getCriterionProgress()` — 🟢 KEEP
- **Engine value:** **HIGH** — These are essential for story completion:
  - `generateDenouementStructure()` — generates the LLM prompt for the final chapters
  - `getCriterionProgress()` — shows how close the story is to completion
- **Why "dead":** The orchestrator calls `checkCompletion()` which uses internal methods. These are additional query APIs.
- **Action:** Wire into CLI `/completion` command to show story completion progress.

---

## 11. character-lifecycle.ts — Dead Exports (456 lines)

### `generateNewCharacter()` — 🔴 DELETE
- **What:** Random character generation without LLM input
- **Why dead:** The novel engine uses LLM-driven character creation, not random generation.
- **Engine value:** **LOW** — Random characters don't serve the narrative quality goals.
- **Action:** Delete. Character creation should always be LLM-driven or prompt-driven.

### Character aging, death, transformation system — 🟢 KEEP (partially integrated)
- **Engine value:** **MEDIUM** — The aging/death system is relevant for:
  - Long-form stories spanning decades
  - Generational narratives
  - Character arc completion (death as culmination)
- **Current integration:** `characterLifecycleManager.advanceTime()` is called per chapter
- **Action:** Keep. Consider wiring `deepenFromLifecycle()` to integrate lifecycle events with psychological profiles.

---

## 12. procedural-world.ts — Partially Integrated (828 lines)

### Current Status — 🟡 INTEGRATED (but limited usage)
- **Wired:** `ensureProceduralWorld()` in orchestrator creates world at story start, stores regions in story state, syncs to knowledge graph
- **Not Wired:** The generated world data (regions, conflicts, history) is **never used in story generation prompts**
- **Engine value:** **MEDIUM-HIGH** — The procedural world provides:
  - Geographic context for story events
  - Location-based plot hooks (nearby dangers, resources)
  - Historical depth (past events that can resurface)
  - Inter-region conflicts that can drive plot

**Current data flow:**
```
Prompt → ProceduralWorldGenerator → regions/history/conflicts → Save to story state → 🛑 END
```

**Intended data flow:**
```
Prompt → ProceduralWorldGenerator → Inject into story generation prompt → LLM uses world context
                                      → Chaos events can trigger regional conflicts
                                      → Characters can travel between regions
```

**Action:** Wire world data into story generation:
1. Add regional context to chaos events ("current region: X, nearby dangers: Y")
2. Inject world history into narrative context for LLM
3. Use regional conflicts as chaos event seeds

---

## 13. command-parser.ts — Dead Functions (704 lines)

### `submitFeedbackToMetaLearner()` — 🔴 DELETE
- **What:** Stub that only `console.log`s
- **Engine value:** **ZERO**
- **Action:** Delete the function. If feedback submission is needed in the future, implement it properly.

### `isSlashCommand()`, `listSkills()` — 🔴 DELETE from barrel exports
- **Why dead:** Only used internally in command parsing
- **Action:** Remove from barrel exports in `index.ts`.

### `/plugin` start/stop subcommands — 🔴 DELETE
- **What:** Unimplemented subcommands that print "not implemented"
- **Action:** Remove.

---

## 14. continuity-analyzer.ts — Dead Function

### `validateAnalysis()` — 🔴 DELETE
- **What:** Private method that validates continuity analysis results
- **Why dead:** Never called. The `analyze()` method produces results but doesn't validate them.
- **Engine value:** **LOW** — Input validation is good practice but this specific method is unreachable.
- **Action:** Either call it from `analyze()` or delete it.

---

## 15. multiway-relationships.ts — Unused Singletons

### `relationshipViewService`, `asyncGroupManagementService` singletons — 🔴 DELETE
- **What:** Singletons created with `noopGraphReader` (all methods return empty/no-op)
- **Why dead:** The orchestrator creates its own instances with a real `GraphReader`
- **Engine value:** **ZERO** — These singletons are broken (noop readers).
- **Action:** Delete. The orchestrator's instances are the correct ones.

---

## Summary Matrix

### 🔴 DELETE (clean up)

| Item | Lines | Rationale | Status |
|------|-------|-----------|--------|
| ~~`visual-translator.ts` → `initVisualTranslator()`~~ | ~~10~~ | Redundant with lazy loading | ✅ **DELETED** |
| ~~`visual-translator.ts` → `enrichBeatWithVisuals()`~~ | ~~100~~ | No callers | ✅ **DELETED** |
| ~~`visual-translator.ts` → `translateStoryToPanels()`~~ | ~~150~~ | Pipeline moved to orchestrator | ✅ **DELETED** |
| ~~`visual-translator.ts` → deprecated hash chain~~ | ~~40~~ | Properly deprecated | ✅ **MADE INTERNAL** |
| ~~Barrel exports: `isSlashCommand`, `listSkills`~~ | — | Internal-only | ✅ **REMOVED** |
| ~~Barrel exports: `callLLMWithTracing`, `callLLMBatch`, `novelLLM`~~ | — | Test-only | ✅ **REMOVED** |
| `narrative-skeleton.ts` → `createFallbackSkeleton()` | ~30 | Useless fallback, never called | 🔴 Remaining |
| `command-parser.ts` → `submitFeedbackToMetaLearner()` | ~5 | Stub with no implementation | 🔴 Remaining |
| `command-parser.ts` → `/plugin` subcommands | ~15 | Unimplemented | 🔴 Remaining |
| `continuity-analyzer.ts` → `validateAnalysis()` | ~15 | Unreachable private method | 🔴 Remaining |
| `character-lifecycle.ts` → `generateNewCharacter()` | ~30 | Random gen doesn't serve engine goals | 🔴 Remaining |
| `multiway-relationships.ts` → noop singletons | ~10 | Broken (noop readers) | 🔴 Remaining |
| Unused imports across files | ~12 | Dead imports | 🔴 Remaining |
| Barrel exports: `createCorrelationId`, `createCorrelationContext` | — | Test-only | 🔴 Remaining |
| Barrel exports: memo cache utils | — | Test-only | 🔴 Remaining |
| Barrel exports: `PROMPT_TEMPLATES` | — | Never imported | 🔴 Remaining |
| **Subtotal: Remaining** | **~120 lines** | | |

### 🔵 IMPLEMENT (fill gaps, ~150 lines)

| Item | Effort | Engine Impact |
|------|--------|--------------|
| observability.ts → 5 TODOs (factionCount, totalMemories, inconsistencyCount, avgExtractionTime, getCurrentChapter) | ~50 lines | **HIGH** — Real health monitoring |
| branch-storage.ts → embedding column (OR delete) | ~30 lines | **MEDIUM** — Semantic branch search |
| state-extractor.ts → FactValidator wiring (actually wired via orchestrator, but document it) | ~5 lines comments | **LOW** — Clarify extension point |

### 🟣 REFACTOR (redesign before integration, ~250 lines)

| Item | Effort | Engine Impact | Status |
|------|--------|--------------|--------|
| ~~`visual-translator.ts` `translateStoryToPanels()`~~ | ~~150 lines~~ | ~~Superior hybrid splitting~~ | ✅ **COMPLETED** — Logic moved to orchestrator |
| ~~`visual-translator.ts` LLM enhancement~~ | ~~200 lines~~ | ~~Complex scene enhancement~~ | ✅ **COMPLETED** — `assemblePanelSpecWithLLM()` with auto-detection |
| ~~`visual-translator.ts` panel cache~~ | ~~80 lines~~ | ~~Avoid duplicate generation~~ | ✅ **COMPLETED** — LRU cache with deterministic hashing |
| ~~`visual-translator.ts` config hot-reload~~ | ~~20 lines~~ | ~~Live config updates~~ | ✅ **COMPLETED** — `reloadVisualConfig()` + `/reload` CLI |
| `config/config-loader.ts` `resolveVisualSpec()` → extract strategy layers into visual-prompt-engineer | ~200 lines | **MEDIUM-HIGH** — Dynamic visual strategy | 🔴 Remaining |
| `validation.ts` `*WithContext` functions → integrate into state extractor pipeline | ~50 lines | **MEDIUM** — Granular validation | 🔴 Remaining |

### 🟡 INTEGRATE (fully built, missing wiring, ~185 lines)

| Item | Effort | Engine Impact | Status |
|------|--------|--------------|--------|
| ~~`enrichBeatWithVisuals()`~~ | ~~5 lines~~ | ~~Single-beat API~~ | ✅ **DELETED** — Not needed |
| narrative-skeleton standalone functions → use in orchestrator | ~20 lines | **MEDIUM** — Better encapsulation | 🔴 Remaining |
| ~~branch-manager auto-merge → wire into saveState()~~ | ~~10 lines~~ | ✅ **DONE** - autoMergeSimilarBranches() called every chapter | ✅ **DONE** |
| branch querying → CLI `/branches` command | ~30 lines | **MEDIUM** — Branch exploration | 🔴 Remaining |
| observability exports → CLI `/health`, `/metrics` commands | ~40 lines | **MEDIUM** — Engine monitoring | 🔴 Remaining |
| ~~motif-tracker → exportToKnowledgeGraph~~ | ~~10 lines~~ | ✅ **DONE** — Already wired | ✅ **DONE** |
| relationship-inertia → CLI `/hooks` command + chaos injection | ~30 lines | **MEDIUM** — Plot hook suggestions | 🔴 Remaining |
| end-game-detection → CLI `/completion` command | ~20 lines | **MEDIUM** — Story progress tracking | 🔴 Remaining |
| performance.ts → rateLimit/throttle → wire into production | ~20 lines | **HIGH** — API rate limiting | 🔴 Remaining |
| procedural-world → inject world data into story prompts | ~30 lines | **MEDIUM-HIGH** — Geographic context | 🔴 Remaining |
| novel-learning-bridge → Phase 1: sync patterns to vector store | ~20 lines | **HIGH** — Self-evolving capability | 🔴 Remaining |
| llm-wrapper → callLLMWithTracing → wire into observability | ~10 lines | **MEDIUM** — LLM tracing | 🔴 Remaining |
| **Subtotal** | **~185 lines** | | |

### 🟢 KEEP (valuable, no action needed)

| Item | Engine Impact |
|------|--------------|
| `memoize()`, `debounce()` | Actively used, critical for performance |
| `callLLMBatch()` | Essential for parallel operations |
| `endGameDetector` functions | Core to story completion |
| `reloadVisualConfig()`, `clearConfigCache()` | Future-proof, dev utilities |
| Deprecated type aliases (`TRAUMA_TAGS`, etc.) | Backward compatibility |

---

## Implementation Priority Roadmap

### ✅ Phase 1 — Visual Pipeline Cleanup (COMPLETED)
1. ✅ ~~Remove `initVisualTranslator()`, `enrichBeatWithVisuals()`, `translateStoryToPanels()`~~
2. ✅ ~~Remove `EnrichedBeat` re-export, make `generateDeterministicVisualHash()` internal~~
3. ✅ ~~Remove dead imports from visual-translator.ts~~
4. ✅ ~~Remove barrel exports: `isSlashCommand`, `listSkills`, `callLLMBatch`, `callLLMWithTracing`, `novelLLM`~~
5. ✅ ~~Update outdated documentation~~

### Phase 2 — Remaining Dead Code (~120 lines)
6. 🔴 Remove `createFallbackSkeleton()`, `submitFeedbackToMetaLearner()`, `validateAnalysis()`, `generateNewCharacter()`
7. 🔴 Remove noop singletons in multiway-relationships.ts
8. 🔴 Remove unused imports across files
9. 🔴 Remove remaining barrel exports (correlation utils, memo cache utils, PROMPT_TEMPLATES)

### Phase 3 — Observability (~80 lines)
10. 🔵 Implement 5 observability TODOs
11. 🟡 Wire observability into CLI `/health` command

### Phase 4 — Config/Validation Refactor (~250 lines)
12. 🟣 Extract `resolveVisualSpec()` strategy layers into visual-prompt-engineer
13. 🟣 Integrate `*WithContext` functions into state extractor

### Phase 5 — Integration (~185 lines)
14. 🟡 Wire narrative-skeleton functions into orchestrator
15. 🟡 Add CLI `/branches`, `/hooks`, `/completion` commands
16. 🟡 Wire performance utils into production (rateLimit, throttle)
17. 🟡 Inject procedural world data into story prompts
18. 🟡 Wire learning bridge Phase 1

---

## Final Health Assessment

| Dimension | Before | After (Phase 1 Complete) | After (All Phases) |
|-----------|--------|-------------------------|-------------------|
| **Dead code lines** | ~600 | ~300 | ~0 |
| **Barrel export hygiene** | 🔴 15 dead exports | ✅ Clean | ✅ Clean |
| **Unused imports** | 🔴 14 | ~12 | ✅ 0 |
| **Visual subsystem** | 🔴 Competing pipelines | ✅ Unified | ✅ Unified |
| **Core pipeline** | ✅ Healthy | ✅ Healthy | ✅ Healthy |
