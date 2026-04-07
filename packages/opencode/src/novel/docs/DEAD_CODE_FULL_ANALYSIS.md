# Novel Engine - Comprehensive Dead Code Analysis

**Date:** 2026-04-05
**Scope:** All 35 source files + 2 config files + 13 test files in `src/novel/`
**Method:** Import/export graph analysis, call chain tracing, external consumer mapping, existing audit cross-reference

---

## Executive Summary

| Category | Count | Severity | Action |
|----------|-------|----------|--------|
| **Completely dead modules** | 0 | — | Previously deleted (`pattern-vector-index.ts`, `faction-detector.ts`) |
| **Orphan files (docs only)** | 6 | 🟢 Info | Documentation artifacts, no code impact |
| **Unused imports** | 11 | 🔴 Remove | ~11 lines, zero risk |
| **Dead exports (no external callers)** | ~40 | 🟡 Review | Public API candidates or remove |
| **Dead functions (never called)** | 8 | 🟡 Review | Defined but unreachable |
| **Class methods never invoked** | 5 | 🟡 Review | Internal dead paths |
| **Feature-flagged dead code** | 3 | 🟡 Review | Flags never enabled in config |
| **Stub/incomplete features** | 4 | 🟡 Decide | Implement or remove |
| **Deprecated code chains** | 2 | 🟢 Keep | Properly marked, backward compat |
| **Test coverage gaps** | 10 modules | 🟡 Address | No test files exist |

---

## 1. Main Story Generation Pipeline (FULLY WIRED ✅)

This is the healthy production path. Every module listed here is actively called:

```
cli/cmd/novel.ts (NovelCommand)
  └── EvolutionOrchestrator (orchestrator.ts)
        ├── loadState() → story_bible.json
        ├── initializeAdvancedModules()
        │     ├── storyWorldMemory.initialize()
        │     ├── storyKnowledgeGraph.initialize()
        │     ├── branchStorage.initialize()
        │     ├── motifTracker.initialize()
        │     ├── enhancedPatternMiner.initialize()
        │     └── learningBridge.initialize()
        ├── ensureNarrativeSkeleton()
        │     ├── createNarrativeSkeleton() → LLM
        │     └── ensureProceduralWorld() → ProceduralWorldGenerator
        ├── runNovelCycle()
        │     ├── evolutionRules.rollChaos() → 2d6 dice
        │     ├── evolutionRules.generateChaosEventWithLLM() → LLM
        │     ├── callLLM() → story text generation
        │     ├── stateExtractor.extract() → LLM state extraction
        │     │     └── validateRawStateUpdateWithWorldContext() → validation.ts
        │     │     └── globalThis.factValidator → ⚠️ NEVER WIRED (stub)
        │     ├── characterDeepener.deepenAllCharacters() → LLM
        │     ├── relationshipAnalyzer.analyzeAllRelationships() → LLM
        │     ├── enhancedPatternMiner.onTurn() → pattern extraction
        │     ├── motifTracker.analyzeMotifEvolution()
        │     ├── relationshipInertiaManager.generatePlotHooks()
        │     ├── characterLifecycleManager.advanceTime()
        │     ├── endGameDetector.checkCompletion()
        │     ├── analyzeRelationshipInstability() → RelationshipViewService
        │     │     └── asyncGroupService (non-blocking faction detection)
        │     ├── generateAndSaveVisualPanels()
        │     │     ├── visual-prompt-engineer.buildPanelSpecWithHybridEngine()
        │     │     │     └── visual-translator.assemblePanelSpec()
        │     │     └── continuity-analyzer.analyze() → LLM
        │     ├── runThematicReflection() → LLM (every N turns)
        │     ├── executeMultiThreadCycle() → MultiThreadNarrativeExecutor (if enabled)
        │     └── saveState() → story_bible.json
        └── dispose() → cleanup
```

**External consumers (outside novel/ directory):**
| Consumer | Imports | Purpose |
|----------|---------|---------|
| `cli/cmd/novel.ts` | `EvolutionOrchestrator`, `loadDynamicPatterns`, `enhancedPatternMiner`, `loadLayeredConfig`, `extractConfigFromPrompt` | **Primary entry point** |
| `evolution/skill.ts` | `getNovelLanguageModel` | AI model for skill evolution |
| `evolution/prompt.ts` | `getNovelLanguageModel` | AI model for prompt evolution |
| `learning/critic.ts` | `getNovelLanguageModel` | AI model for critic evaluation |
| `learning/consistency-checker.ts` | `getNovelLanguageModel` | AI model for consistency checking |
| `middleware/state-auditor.ts` | `CharacterState`, `StoryBible` (types only) | Type definitions |

---

## 2. Completely Dead Modules (ALREADY DELETED ✅)

These were identified in previous audits (`DEAD_CODE_AUDIT.md`, `ANALYSIS_REPORT.md`) and have been removed:

| Module | Previous Status | Current State |
|--------|----------------|---------------|
| `pattern-vector-index.ts` | Orphan, all methods stubs, only test callers | ✅ DELETED |
| `faction-detector.ts` | Replaced by `AsyncGroupManagementService` | ✅ DELETED |

Only documentation references remain (in `docs/` files and audit reports).

---

## 3. Unused Imports (11 total) — 🔴 REMOVE

These `import` statements exist but the imported symbols are never referenced in the file body:

| File | Unused Import | Action |
|------|--------------|--------|
| `pattern-miner-enhanced.ts` | `memoize` (from `./performance`) | Remove |
| `pattern-miner-enhanced.ts` | `Instance` (from `../project/instance`) | Remove |
| `narrative-skeleton.ts` | `Instance` (from `../project/instance`) | Remove |
| `story-world-memory.ts` | `Instance` (from `../project/instance`) | Remove |
| `story-world-memory.ts` | `CharacterState` (type import) | Remove |
| `story-knowledge-graph.ts` | `Instance` (from `../project/instance`) | Remove |
| `motif-tracker.ts` | `Instance` (from `../project/instance`) | Remove |
| `branch-storage.ts` | `Instance` (from `../project/instance`) | Remove |
| `procedural-world.ts` | `Instance` (from `../project/instance`) | Remove |
| `command-parser.ts` | `Instance` (from `../project/instance`) | Remove |
| `dynamic-prompt.ts` | `z` (from `zod`) | Remove |
| `visual-prompt-engineer.ts` | `generateDeterministicVisualHash` (local import) | Remove |
| `observability.ts` | `getNovelLanguageModel` (from `./model`) | Remove |
| `observability.ts` | `generateText` (from `ai`) | Remove |

**Root cause:** `Instance` was likely imported by 8 files before path helpers in `novel-config.ts` became the standard access pattern. All these files now use `getStoryBiblePath()`, `getNovelDataDir()`, etc. instead.

**Total removable lines:** ~15

---

## 4. Dead Exports (no external callers) — 🟡 REVIEW

These are defined and exported but **never imported by any other file**. They fall into three categories:

### 4.1 Internal helpers (not meant for external use) — Remove from barrel exports

| Module | Dead Export | Notes |
|--------|------------|-------|
| `command-parser.ts` | `isSlashCommand()` | Only used internally for command detection |
| `command-parser.ts` | `listSkills()` | Only used internally |
| ~~`branch-manager.ts`~~ | ~~`getEventsByBranchId`~~ | ✅ **NOW ACTIVE** - called by orchestrator |
| ~~`branch-manager.ts`~~ | ~~`getBranchTree`~~ | ✅ **NOW ACTIVE** - called via orchestrator.getBranchTree() |
| ~~`branch-manager.ts`~~ | ~~`getBranchPath`~~ | ✅ **NOW ACTIVE** - called via orchestrator.getBranchPath() |
| ~~`branch-manager.ts`~~ | ~~`autoMergeSimilarBranches`~~ | ✅ **NOW ACTIVE** - orchestrator.ts:1844 |
| ~~`branch-manager.ts`~~ | ~~`mergeBranches`~~ | ✅ **NOW ACTIVE** - called by autoMergeSimilarBranches |
| ~~`branch-manager.ts`~~ | ~~`detectSimilarBranches`~~ | ✅ **NOW ACTIVE** - called by autoMergeSimilarBranches |
| `branch-storage.ts` | `loadBranchesByEventType` | Internal storage querying |
| `branch-storage.ts` | `loadBranchTree` | Internal storage querying |
| `branch-storage.ts` | `exportToJson` | Internal utility |
| `branch-storage.ts` | `importFromJson` | Internal utility |
| `branch-storage.ts` | `BranchEvent` (interface) | Type defined but never consumed |

### 4.2 Planned infrastructure (never used) — Decide: implement or archive

| Module | Dead Export | Notes |
|--------|------------|-------|
| `end-game-detection.ts` | `generateDenouementStructure` | Planned end-game structuring, no caller |
| `end-game-detection.ts` | `getCriterionProgress` | Progress reporting, no caller |
| ~~`motif-tracker.ts`~~ | ~~`exportToKnowledgeGraph`~~ | ✅ **NOW ACTIVE** - called in orchestrator.ts:2140, nodes/edges synced to storyKnowledgeGraph |
| `relationship-inertia.ts` | `getHooksForCharacters` | Only called in tests |
| `relationship-inertia.ts` | `getPlotHooksReport` | Only called in tests |
| `story-knowledge-graph.ts` | `detectInconsistency` | Observability has `// TODO: detect inconsistencies` |
| `story-knowledge-graph.ts` | `getRelationshipsForCharacters` | Only called via graphReader adapter |
| `story-knowledge-graph.ts` | `addGroup`, `addMemberToGroup`, `getGroupMembers`, `getAllGroups` | Group management only called via `asyncGroupService`, not directly |
| `narrative-skeleton.ts` | `createNarrativeSkeleton` | Only called by class methods, not standalone |
| `narrative-skeleton.ts` | `loadNarrativeSkeleton` | Only called by class methods, not standalone |
| `narrative-skeleton.ts` | `updateStoryLineProgress` | Standalone convenience function, no caller |
| `narrative-skeleton.ts` | `getNextKeyBeat` | Standalone convenience function, no caller |
| `narrative-skeleton.ts` | `getActiveStoryLines` | Standalone convenience function, no caller |
| `narrative-skeleton.ts` | `getThematicMotifString` | Standalone convenience function, no caller |
| `narrative-skeleton.ts` | `getOverallCompletionPercentage` | Standalone convenience function, no caller |
| `narrative-skeleton.ts` | `updateNarrativeSkeleton` | Standalone convenience function, no caller |
| `narrative-skeleton.ts` | `createFallbackSkeleton` | Internal, never called |
| `llm-wrapper.ts` | `callLLMWithTracing` | Never called in production |
| `llm-wrapper.ts` | `callLLMBatch` | Only used in tests |
| `llm-wrapper.ts` | `novelLLM` namespace | Never imported |
| `validation.ts` | `validateGoalWithContext` | No caller |
| `validation.ts` | `validateTraumaWithContext` | No caller |
| `validation.ts` | `validateSkillWithContext` | No caller |
| `validation.ts` | `validateCharacterUpdateWithContext` | No caller |
| `validation.ts` | `validateRelationshipUpdateWithContext` | No caller |
| `validation.ts` | `createCorrelationId` | Only used in tests |
| `validation.ts` | `createCorrelationContext` | Only used in tests |
| `performance.ts` | `rateLimit` | Only used in tests |
| `performance.ts` | `throttle` | Only used in tests |
| `performance.ts` | `batch` | Only used in tests |
| `performance.ts` | `lazy` | Only used in tests |
| `performance.ts` | `clearMemoCache` | Only used in tests |
| `performance.ts` | `deleteMemoKey` | Only used in tests |
| `performance.ts` | `getMemoStats` | Only used in tests |
| `observability.ts` | `exportTraceData` | No consumer |
| `observability.ts` | `getErrorSummary` | No consumer |
| `observability.ts` | `getMetricsHistory` | No consumer |
| `observability.ts` | `getTraceEvents` | No consumer |
| `dynamic-prompt.ts` | `PROMPT_TEMPLATES` | Exported but never imported |

### 4.3 Deprecated — Keep for backward compatibility, plan removal

| Module | Dead Export | Notes |
|--------|------------|-------|
| `types.ts` | `TRAUMA_TAGS` | `@deprecated` → use `getTraumaTags()` |
| `types.ts` | `SKILL_CATEGORIES` | `@deprecated` → use `getSkillCategories()` |
| `types.ts` | `CHARACTER_STATUS` | `@deprecated` → use `getCharacterStatus()` |
| `visual-translator.ts` | `generateVisualHash` | `@deprecated` → use `generateDeterministicVisualHash` |
| `visual-translator.ts` | `generateCharacterRefUrl` | `@deprecated` → use `generateStableCharacterRefUrl` |

### 4.4 Config loader dead exports

| Module | Dead Export | Notes |
|--------|------------|-------|
| `config/config-loader.ts` | `resolveVisualSpec` | **Core resolver, NEVER called** in production. Only referenced in test and TODO comment |
| `config/config-loader.ts` | `reloadVisualConfig` | Hot-reload, never used |
| `config/config-loader.ts` | `clearConfigCache` | Cache management, never used |
| `config/config-loader.ts` | `VisualContext` (type) | Exported but never consumed |
| `config/config-loader.ts` | `ResolvedVisualSpec` (type) | Exported but never consumed |

**Note on `resolveVisualSpec`:** The config/index.ts has a TODO comment: *"Refactor visual subsystem to use resolveVisualSpec() instead"*. The entire visual config resolution pipeline is built but bypassed — the visual subsystem uses `visual-prompt-engineer.ts`'s hybrid engine instead.

---

## 5. Dead Functions (defined but never called) — 🟡 REVIEW

| Function | File | Details |
|----------|------|---------|
| `initVisualTranslator()` | `visual-translator.ts:35` | Initialization function, never called. Config is loaded lazily via `getConfig()` instead |
| `enrichBeatWithVisuals()` | `visual-translator.ts:744` | No callers outside the file |
| `translateStoryToPanels()` | `visual-translator.ts:1136` | No callers outside the file |
| `submitFeedbackToMetaLearner()` | `command-parser.ts:27` | Stub that only does `console.log`. Called by `/feedback` command but does nothing functional |
| `validateAnalysis()` | `continuity-analyzer.ts:240` | Private method defined but never invoked within the file |

---

## 6. Class Methods Never Invoked — 🟡 REVIEW

| Class | Method | File | Details |
|-------|--------|------|---------|
| ~~`CharacterDeepener`~~ | ~~`deepenFromLifecycle()`~~ | ✅ **NOW ACTIVE** - orchestrator prefers this when lifecycle data available |
| `StoryKnowledgeGraph` | `detectInconsistency()` | `story-knowledge-graph.ts` | Has TODO in observability but never runs |
| `EvolutionOrchestrator` | `buildGraphReader()` | `orchestrator.ts` | Called internally to create graphReader, but the returned reader's `getRelationshipHistory` is a complex implementation that scans branchHistory — may be expensive and untested in production |
| `NovelObservability` | `collectMetrics()` getter methods | `observability.ts` | All getter methods on the singleton are never called externally except in tests |
| `ContinuityAnalyzer` | `validateAnalysis()` | `continuity-analyzer.ts:240` | Private method, never called |

---

## 7. Feature-Flagged Dead Code (flags never enabled) — 🟡 REVIEW

| Location | Flag | Details |
|----------|------|---------|
| `orchestrator.ts` | `multiThreadEnabled` | Multi-thread narrative executor only instantiated when config flag is set. Now has CLI flag (`--multi-thread`), so **partially integrated** but off by default |
| `orchestrator.ts` | `proceduralWorld` | `ProceduralWorldGenerator` is initialized but the world data is only used for location generation — limited integration |
| `branch-storage.ts` | `enableEmbeddings` | Database column `embedding: text().notNull().default('')` exists but never populated. Config option exists but never wired |
| `state-extractor.ts` | `globalThis.factValidator` | Extension point declared but never populated. `applyFactValidationCorrections()` always skips |

---

## 8. Stub / Incomplete Features — 🟡 DECIDE

### 8.1 `state-extractor.ts` — FactValidator extension point

```ts
interface FactValidator {
  validateExtractedState(updates: any, currentState: any): Promise<FactValidationReport>
}
declare global {
  var factValidator: FactValidator | undefined
}
```

**Status:** Extension point that is never populated. The `applyFactValidationCorrections()` method checks for `globalThis.factValidator` but it's always `undefined`.

**Note:** `orchestrator.ts` has `wireFactValidator()` which DOES populate `globalThis.factValidator` with `stateAuditor`. This is **actually wired** in the orchestrator's `initializeAdvancedModules()` path. The audit in previous reports was incorrect about this being completely dead.

### 8.2 `branch-storage.ts` — embedding column

```ts
// In schema:
embedding: text().notNull().default('')  // Column exists but never populated
```

**Status:** Database column exists, config option exists, but no code writes embeddings.

### 8.3 `command-parser.ts` — `/feedback` command

```ts
async function submitFeedbackToMetaLearner(feedback: StoryFeedback): Promise<void> {
  console.log(` Submitting feedback to MetaLearner: ${feedback.storyId} (rating: ${feedback.rating}/10)`)
}
```

**Status:** Stub that only logs. No actual submission logic.

### 8.4 `observability.ts` — 5 TODOs with hardcoded zeros

| TODO | Location | Impact |
|------|----------|--------|
| `factionCount: 0` | `collectMetrics()` | Faction count always zero in health report |
| `totalMemories: 0` | `collectMetrics()` | Memory system usage untracked |
| `inconsistencyCount: 0` | `collectMetrics()` | Graph inconsistency detection never runs |
| `avgExtractionTime: 0` | `collectMetrics()` | State extraction timing not measured |
| `getCurrentChapter` returns `1` | private method | Hardcoded, no orchestrator wiring |

---

## 9. Singleton Instances Never Used

These singletons are exported but the orchestrator creates its own instances instead of using them:

| Singleton | File | Details |
|-----------|------|---------|
| `characterDeepener` | `character-deepener.ts:518` | Orchestrator creates `new CharacterDeepener()` with custom config |
| `relationshipAnalyzer` | `relationship-analyzer.ts:481` | Orchestrator creates `new RelationshipAnalyzer()` |
| ~~`branchManager`~~ | ~~`branch-manager.ts:350`~~ | ✅ **NOTE**: While the singleton is unused, orchestrator creates its own BranchManager instance and actively uses it (addBranch, autoMergeSimilarBranches, pruneBranches, getStats) |
| `proceduralWorldGenerator` | `procedural-world.ts:827` | Orchestrator creates its own instance with custom config |
| `relationshipViewService` | `multiway-relationships.ts:646` | Created with `noopGraphReader`; orchestrator creates its own instances |
| `asyncGroupManagementService` | `multiway-relationships.ts:647` | Created with `noopGraphReader`; orchestrator creates its own instances |

**Pattern:** The orchestrator consistently prefers fresh instances over singletons to allow dependency injection and custom configuration. The exported singletons are effectively dead code.

---

## 10. Test Coverage Gaps

### Modules WITH tests (13 test files):

| Test File | Module Under Test |
|-----------|------------------|
| `tests/branch-manager.test.ts` | `branch-manager.ts` |
| `tests/branch-storage.test.ts` | `branch-storage.ts` |
| `tests/evolution-rules.test.ts` | `evolution-rules.ts` |
| `tests/llm-wrapper.test.ts` | `llm-wrapper.ts` |
| `tests/motif-tracker.test.ts` | `motif-tracker.ts` |
| `tests/multiway-relationships.test.ts` | `multiway-relationships.ts` |
| `tests/observability.test.ts` | `observability.ts` |
| `tests/pattern-miner-enhanced.test.ts` | `pattern-miner-enhanced.ts` |
| `tests/procedural-world.test.ts` | `procedural-world.ts` |
| `tests/relationship-inertia.test.ts` | `relationship-inertia.ts` |
| `tests/story-knowledge-graph.test.ts` | `story-knowledge-graph.ts` |
| `tests/story-world-memory.test.ts` | `story-world-memory.ts` |
| `tests/validation.test.ts` | `validation.ts` |

### Root-level test files:
| Test File | Module Under Test |
|-----------|------------------|
| `continuity-analyzer.test.ts` | `continuity-analyzer.ts` |
| `visual-orchestrator.test.ts` | `visual-orchestrator.ts` |
| `novel-learning-bridge.test.ts` | `novel-learning-bridge.ts` |
| `performance.test.ts` | `performance.ts` |
| `phase5.test.ts` | Integration tests (multiple modules) |

### Modules WITHOUT dedicated tests:

| Module | Has Test? | Risk |
|--------|-----------|------|
| `orchestrator.ts` | ❌ No | HIGH — core module |
| `state-extractor.ts` | ❌ No | HIGH — critical data flow |
| `character-deepener.ts` | ❌ No | MEDIUM |
| `relationship-analyzer.ts` | ❌ No | MEDIUM |
| `narrative-skeleton.ts` | ❌ No | MEDIUM |
| `novel-config.ts` | ❌ No | MEDIUM |
| `model.ts` | ❌ No | LOW — thin wrapper |
| `types.ts` | ❌ No | LOW — type definitions |
| `command-parser.ts` | ❌ No | MEDIUM — CLI entry point |
| `dynamic-prompt.ts` | ❌ No | LOW — prompt templates |
| `visual-translator.ts` | ❌ No | MEDIUM |
| `visual-prompt-engineer.ts` | ❌ No | MEDIUM |
| `end-game-detection.ts` | ❌ No | LOW |
| `character-lifecycle.ts` | ❌ No | LOW |
| `multi-thread-narrative.ts` | ❌ No | MEDIUM — new feature |
| `thematic-analyst.ts` | ❌ No | MEDIUM |
| `config/config-loader.ts` | ❌ No | LOW |

---

## 11. Orphan Documentation Files

These files in `docs/` reference modules that no longer exist or describe planned features:

| File | References | Status |
|------|-----------|--------|
| `docs/INTEGRATION_COMPLETE.md` | `pattern-vector-index.ts`, `faction-detector.ts` | Stale — modules deleted |
| `docs/INTEGRATION_IMPLEMENTATION.md` | `pattern-vector-index.ts`, `faction-detector.ts` | Stale — modules deleted |
| `docs/INTEGRATION_STATUS.md` | `pattern-vector-index.ts`, `faction-detector.ts` | Stale — modules deleted |
| `docs/EMBEDDING_ANALYSIS.md` | `pattern-vector-index.ts` | Stale — module deleted |
| `docs/LEARNING_BRIDGE_DESIGN.md` | `pattern-vector-index.ts` | Stale — module deleted |
| `docs/CODE_ARCHITECTURE.html` | `pattern-vector-index.ts`, `faction-detector.ts` | Stale — modules deleted |

---

## 12. Priority-Ordered Action Plan

### 🔴 HIGH — Clean up (low risk, ~30 lines)

| File | Action | Lines |
|------|--------|-------|
| `pattern-miner-enhanced.ts` | Remove unused imports `memoize`, `Instance` | 2 |
| `observability.ts` | Remove unused imports `getNovelLanguageModel`, `generateText` | 2 |
| `visual-prompt-engineer.ts` | Remove unused import `generateDeterministicVisualHash` | 1 |
| `dynamic-prompt.ts` | Remove unused import `z` | 1 |
| `narrative-skeleton.ts` | Remove unused import `Instance` | 1 |
| `story-world-memory.ts` | Remove unused imports `Instance`, `CharacterState` | 2 |
| `story-knowledge-graph.ts` | Remove unused import `Instance` | 1 |
| `motif-tracker.ts` | Remove unused import `Instance` | 1 |
| `branch-storage.ts` | Remove unused import `Instance` | 1 |
| `procedural-world.ts` | Remove unused import `Instance` | 1 |
| `command-parser.ts` | Remove unused import `Instance` | 1 |

### 🟡 MEDIUM — Dead exports and functions (review and decide)

#### 2A. Remove from barrel exports (internal helpers, ~15 exports)

| Module | Dead Exports |
|--------|-------------|
| `command-parser.ts` | `isSlashCommand`, `listSkills` |
| ~~`branch-manager.ts`~~ | ~~`getEventsByBranchId`, `getBranchTree`, `getBranchPath`, `autoMergeSimilarBranches`, `mergeBranches`, `detectSimilarBranches`~~ — ✅ ALL NOW ACTIVE |
| `branch-storage.ts` | `loadBranchesByEventType`, `loadBranchTree`, `exportToJson`, `importFromJson`, `BranchEvent` |
| `llm-wrapper.ts` | `callLLMWithTracing`, `callLLMBatch`, `novelLLM` |
| `validation.ts` | All `*WithContext` functions, `createCorrelationId`, `createCorrelationContext` |
| `performance.ts` | `rateLimit`, `throttle`, `batch`, `lazy`, `clearMemoCache`, `deleteMemoKey`, `getMemoStats` |
| `observability.ts` | `exportTraceData`, `getErrorSummary`, `getMetricsHistory`, `getTraceEvents` |
| `dynamic-prompt.ts` | `PROMPT_TEMPLATES` |

#### 2B. Delete dead functions (~150 lines)

| Module | Dead Function | Lines |
|--------|--------------|-------|
| `visual-translator.ts` | `initVisualTranslator()` | ~10 |
| `visual-translator.ts` | `enrichBeatWithVisuals()` | ~100 |
| `visual-translator.ts` | `translateStoryToPanels()` | ~50 |
| `command-parser.ts` | `submitFeedbackToMetaLearner()` | ~5 |
| `continuity-analyzer.ts` | `validateAnalysis()` | ~15 |
| `narrative-skeleton.ts` | `createFallbackSkeleton()` | ~30 |

#### 2C. Decide on stub/incomplete features

| Item | Decision Needed |
|------|----------------|
| `branch-storage.ts` embedding column | Implement embedding generation OR remove column + config |
| `command-parser.ts` `/feedback` command | Implement actual submission OR remove command |
| `observability.ts` 5 TODOs | Wire real metrics OR remove placeholder code |
| `end-game-detection.ts` dead exports | Implement denouement structure OR remove exports |
| ~~`motif-tracker.ts` `exportToKnowledgeGraph`~~ | ✅ **ALREADY WIRED** - called in orchestrator.ts:2140 |
| `relationship-inertia.ts` dead exports | Wire to CLI/report OR remove |

### 🟢 LOW — Technical debt (documented, no urgency)

| Item | Notes |
|------|-------|
| `types.ts` deprecated aliases | Keep for backward compat, plan removal in next major |
| `visual-translator.ts` deprecated hash functions | Keep for backward compat |
| `config/config-loader.ts` dead exports | `resolveVisualSpec`, `reloadVisualConfig`, `clearConfigCache` — decide: integrate into visual pipeline or archive |
| Orphan docs in `docs/` | Update or delete stale documentation |

---

## 13. Health Score by Module

| Module | Integration | Dead Code | Tests | Verdict |
|--------|-------------|-----------|-------|---------|
| `orchestrator.ts` | ✅ Full | ✅ Clean | ❌ No test | ⚠️ Core module, needs test |
| `state-extractor.ts` | ✅ Full | ⚠️ FactValidator (actually wired) | ❌ No test | ⚠️ Needs test |
| `evolution-rules.ts` | ✅ Full | ✅ Clean | ✅ Yes | ✅ Healthy |
| `character-deepener.ts` | ✅ Full | ⚠️ 1 dead method + singleton | ❌ No test | ⚠️ Minor cleanup |
| `relationship-analyzer.ts` | ✅ Full | ⚠️ Singleton unused | ❌ No test | ⚠️ Minor cleanup |
| ~~`branch-manager.ts`~~ | ✅ **Full** | ✅ **All exports active** | ✅ Yes | ✅ **Healthy** |
| `branch-storage.ts` | ✅ Partial | ⚠️ 5 dead exports + embedding column | ✅ Yes | 🟡 Review needed |
| `visual-orchestrator.ts` | ✅ Full | ✅ Clean | ✅ Yes | ✅ Healthy |
| `visual-prompt-engineer.ts` | ✅ Full | ⚠️ 1 dead import | ❌ No test | ⚠️ Minor cleanup |
| `visual-translator.ts` | ✅ Partial | 🔴 3 dead functions + deprecated chain | ❌ No test | 🔴 Cleanup needed |
| `story-knowledge-graph.ts` | ✅ Partial | ⚠️ 6 dead exports | ✅ Yes | 🟡 Review needed |
| `story-world-memory.ts` | ✅ Partial | ⚠️ 2 dead imports | ✅ Yes | ⚠️ Minor cleanup |
| `pattern-miner-enhanced.ts` | ✅ Full | ⚠️ 2 dead imports | ✅ Yes | ⚠️ Minor cleanup |
| ~~`motif-tracker.ts`~~ | ✅ **Full** | ✅ **1 dead import only** | ✅ Yes | ✅ **Healthy** |
| `relationship-inertia.ts` | ✅ Partial | ⚠️ 2 dead exports | ✅ Yes | 🟡 Review needed |
| `character-lifecycle.ts` | ✅ Partial | ✅ Clean | ❌ No test | ✅ Healthy |
| `end-game-detection.ts` | ✅ Partial | ⚠️ 2 dead exports | ❌ No test | 🟡 Review needed |
| `narrative-skeleton.ts` | ✅ Partial | 🔴 1 dead import + 8 dead exports | ❌ No test | 🔴 Review needed |
| `novel-config.ts` | ✅ Full | ✅ Clean | ❌ No test | ✅ Healthy |
| `llm-wrapper.ts` | ✅ Partial | ⚠️ 3 dead exports | ✅ Yes | 🟡 Review needed |
| `validation.ts` | ✅ Partial | ⚠️ 7 dead exports | ✅ Yes | 🟡 Review needed |
| `performance.ts` | ✅ Partial | ⚠️ 7 dead exports | ✅ Yes | 🟡 Review needed |
| `command-parser.ts` | ✅ Partial | 🔴 1 dead import + 2 dead exports + 1 stub | ❌ No test | 🔴 Cleanup needed |
| `observability.ts` | ✅ Partial | 🔴 2 dead imports + 4 dead exports + 5 TODOs | ✅ Yes | 🔴 Review needed |
| `model.ts` | ✅ Full | ✅ Clean | ❌ No test | ✅ Healthy |
| `dynamic-prompt.ts` | ✅ Partial | ⚠️ 1 dead import + 1 dead export | ❌ No test | ⚠️ Minor cleanup |
| `continuity-analyzer.ts` | ✅ Full | ⚠️ 1 dead private method | ✅ Yes | ⚠️ Minor cleanup |
| `multi-thread-narrative.ts` | ✅ Integrated (flag-gated) | ✅ Clean | ❌ No test | ✅ Healthy |
| `multiway-relationships.ts` | ✅ Full | ⚠️ 2 unused singletons | ✅ Yes | ⚠️ Minor cleanup |
| `procedural-world.ts` | ✅ Partial | ⚠️ 1 dead import + unused singleton | ✅ Yes | ⚠️ Minor cleanup |
| `novel-learning-bridge.ts` | ⚠️ Partially wired | ✅ Clean | ✅ Yes | 🟡 Decide: fully integrate or archive |
| `thematic-analyst.ts` | ✅ Full | ✅ Clean | ❌ No test | ✅ Healthy |
| `config/config-loader.ts` | ⚠️ Partially wired | 🔴 5 dead exports | ❌ No test | 🔴 Decide: integrate or archive |

---

## 14. Summary Statistics

| Metric | Count |
|--------|-------|
| **Total source files** | 35 (.ts) + 2 (config/) |
| **Total test files** | 18 |
| **Dead modules (already deleted)** | 2 |
| **Unused imports** | 14 |
| **Dead exports** | ~40 |
| **Dead functions** | 5 |
| **Dead class methods** | 5 |
| **Unused singletons** | 6 |
| **Feature-flagged dead paths** | 4 |
| **Stub/incomplete features** | 4 |
| **Deprecated chains** | 2 |
| **Modules without tests** | 17 |
| **Orphan doc files** | 6 |
| **Total estimated removable lines** | ~300+ |

---

## 15. Corrected Findings (vs Previous Audits)

The previous `DEAD_CODE_AUDIT.md` and `ANALYSIS_REPORT.md` contained two inaccuracies that this analysis corrects:

1. **`globalThis.factValidator` is NOT dead** — `orchestrator.ts` has `wireFactValidator()` which populates it with `stateAuditor` during `initializeAdvancedModules()`. The previous audits missed this wiring.

2. **`multi-thread-narrative.ts` IS integrated** — The `ANALYSIS_REPORT.md` marked it as orphan, but it has since been integrated with CLI flags (`--multi-thread`). It is off by default but has a clear activation path.
