# Novel Engine — Dead Code & Integration Audit (v2)

**Date:** 2026-04-03
**Scope:** All 29 source files + 2 config files + 15 test files
**Method:** Import graph analysis + grep verification of every claimed caller

---

## Summary

| Category | Count | Status |
|----------|-------|--------|
| Unused imports | 11 | 🔴 Remove |
| Dead exports (no external callers) | ~40 | 🟡 Safe to keep or remove |
| Completely dead modules | 2 | 🔴 Discard or integrate |
| Deprecated code chains | 2 | 🟢 Already marked |
| Incomplete integration (TODOs) | 5 | 🟡 Address |

---

## 1. Unused Imports (11 total)

These imports are present but never referenced in the file body:

| File | Unused Import | Action |
|------|--------------|--------|
| `pattern-miner-enhanced.ts` | `memoize`, `Instance` | Remove |
| `narrative-skeleton.ts` | `Instance` | Remove |
| `story-world-memory.ts` | `Instance`, `CharacterState` | Remove |
| `story-knowledge-graph.ts` | `Instance` | Remove |
| `motif-tracker.ts` | `Instance` | Remove |
| `branch-storage.ts` | `Instance` | Remove |
| `procedural-world.ts` | `Instance` | Remove |
| `command-parser.ts` | `Instance` | Remove |
| `dynamic-prompt.ts` | `z` (zod) | Remove |
| `visual-prompt-engineer.ts` | `generateDeterministicVisualHash` | Remove |
| `observability.ts` | `getNovelLanguageModel` | Remove |

**Note:** `Instance` was imported by 7 files, likely from a previous pattern that was later replaced by `Instance` accessed via other modules or by path helpers in `novel-config.ts`.

---

## 2. Completely Dead Modules (not wired into production flow)

### 2.1 `pattern-vector-index.ts` — ⚠️ ORPHAN

- **Lines:** ~170
- **Callers:** Only `tests/pattern-vector-index.test.ts`
- **All getter methods** (`getPatternsByType`, `getTopPatterns`, `getStats`) return empty/zero
- **Mutation methods** (`updateStrength`, `removePattern`) hardcoded to return `false`
- **Recommendation:** **DISCARD**. The `NovelVectorBridge` (in `novel-learning-bridge.ts`) already provides the same functionality. This wrapper adds no value and nobody calls it.

### 2.2 `faction-detector.ts` — ⚠️ ORPHAN (replaced)

- **Lines:** ~150
- **Previous callers:** Was called by `orchestrator.ts` step 5
- **Current status:** Replaced by `asyncGroupService` (non-blocking faction detection via `multiway-relationships.ts`)
- **Import removed** from orchestrator, field deleted
- **Recommendation:** **DISCARD**. Superseded by the `AsyncGroupManagementService` read-write architecture.

---

## 3. Modules Previously Thought Dead But Actually Integrated (False Positives)

| Module | Verified Caller |
|--------|----------------|
| `character-deepener.ts` | `orchestrator.ts:1585` — `this.characterDeepener.deepenCharacter()` called for each major character per chapter |
| `relationship-analyzer.ts` | `orchestrator.ts:756` — `this.relationshipAnalyzer.analyzeAllRelationships()` called in `generateBranches()` |

These modules **are** in the production flow. They were flagged by the automated scan but have real callers.

---

## 4. Dead Exports (no external callers — ~40 functions)

These are defined and exported but never imported by any other file. They are **not** dead per se (public API), but are candidates for removal if not planned for external use.

### 4.1 By Module

**`branch-manager.ts`** (6 dead exports):
- `getEventsByBranchId`
- `getBranchTree`
- `getBranchPath`
- `autoMergeSimilarBranches`
- `mergeBranches` (only called by `autoMergeSimilarBranches`)
- `detectSimilarBranches` (only called by `autoMergeSimilarBranches`)

**`branch-storage.ts`** (4 dead exports):
- `loadBranchesByEventType`
- `loadBranchTree`
- `exportToJson`
- `importFromJson`

**`end-game-detection.ts`** (2 dead exports):
- `generateDenouementStructure`
- `getCriterionProgress`

**`character-lifecycle.ts`** (1 dead export):
- `generateNewCharacter` — random generation, no LLM input

**`motif-tracker.ts`** (1 dead export):
- `exportToKnowledgeGraph` — returns nodes/edges but nobody consumes them

**`relationship-inertia.ts`** (2 dead exports):
- `getHooksForCharacters`
- `getPlotHooksReport`

**`story-knowledge-graph.ts`** (6 dead exports):
- `detectInconsistency` — observability has `// TODO: detect inconsistencies`
- `getRelationshipsForCharacters`
- `addGroup`, `addMemberToGroup`, `getGroupMembers`, `getAllGroups` — group management only called via `asyncGroupService`, not directly

**`narrative-skeleton.ts`** (7 dead exports):
- `createNarrativeSkeleton`, `loadNarrativeSkeleton` — only called by class methods, not standalone
- `updateStoryLineProgress`, `getNextKeyBeat`, `getActiveStoryLines`, `getThematicMotifString`, `getOverallCompletionPercentage`, `updateNarrativeSkeleton` — standalone convenience functions, no callers
- `createFallbackSkeleton` — internal, never called

**`llm-wrapper.ts`** (3 dead exports):
- `callLLMWithTracing` — never called in production
- `callLLMBatch` — only used in tests
- `novelLLM` namespace — never imported

**`validation.ts`** (7 dead exports):
- `validateGoalWithContext`
- `validateTraumaWithContext`
- `validateSkillWithContext`
- `validateCharacterUpdateWithContext`
- `validateRelationshipUpdateWithContext`
- `createCorrelationId`, `createCorrelationContext` — only used in tests

**`performance.ts`** (7 dead exports):
- `rateLimit`, `throttle`, `batch`, `lazy` — only used in tests
- `clearMemoCache`, `deleteMemoKey`, `getMemoStats` — only used in tests

**`visual-translator.ts`** (4 dead exports):
- `generateVisualHash` (deprecated) → `generateCharacterRefUrl` (deprecated) — dead chain
- `enrichBeatWithVisuals`
- `translateStoryToPanels`

**`visual-orchestrator.ts`** (2 dead exports):
- `planPanelSegments` — only called internally
- `generateAndSaveVisualPanels` — only called internally

**`command-parser.ts`** (2 dead exports):
- `isSlashCommand` — never imported
- `listSkills` — never imported

**`config/config-loader.ts`** (5 dead exports):
- `resolveVisualSpec` — the core resolver, never called
- `reloadVisualConfig`, `clearConfigCache` — hot-reload, never used
- `VisualContext`, `ResolvedVisualSpec` types — exported but never consumed

**`dynamic-prompt.ts`** (1 dead export):
- `PROMPT_TEMPLATES` — exported but never imported by production code

**`observability.ts`** (4 dead exports):
- `exportTraceData`, `getErrorSummary`, `getMetricsHistory`, `getTraceEvents` — observability exports, no consumers

### 4.2 Assessment

These fall into three categories:

| Category | Count | Recommendation |
|----------|-------|---------------|
| **Internal helpers** (not meant for external use) | ~15 | Remove from barrel exports, keep as private methods |
| **Planned but never used** (infrastructure) | ~15 | Keep as public API, document, or remove |
| **Deprecated** | 2 | Remove entirely |

---

## 5. Incomplete Integration (TODO items)

### 5.1 `observability.ts` — 5 TODOs

| TODO | Location | Impact |
|------|----------|--------|
| `factionCount: 0` | `collectMetrics()` | Faction count always zero in health report |
| `totalMemories: 0` | `collectMetrics()` | Memory system usage untracked |
| `inconsistencyCount: 0` | `collectMetrics()` | Graph inconsistency detection never runs |
| `avgExtractionTime: 0` | `collectMetrics()` | State extraction timing not measured |
| `getCurrentChapter` returns `1` | private method | Hardcoded, no orchestrator wiring |

### 5.2 `branch-storage.ts` — embedding column

- Database column `embedding: text().notNull().default('')` exists but never populated
- Config option `enableEmbeddings` exists but never wired
- **Recommendation:** Implement or remove column

### 5.3 `state-extractor.ts` — `FactValidator` extension point

- `globalThis.factValidator` is declared but never populated
- `applyFactValidationCorrections()` checks for it, always skips
- **Recommendation:** Document as extension point or remove

---

## 6. Deprecated Code Chains

### 6.1 `types.ts` — Deprecated constant aliases

```ts
/** @deprecated Use getTraumaTags() */
export const TRAUMA_TAGS = DEFAULT_TRAUMA_TAGS
/** @deprecated Use getSkillCategories() */
export const SKILL_CATEGORIES = DEFAULT_SKILL_CATEGORIES
/** @deprecated Use getCharacterStatus() */
export const CHARACTER_STATUS = DEFAULT_CHARACTER_STATUS
```

Properly marked. Keep for backward compatibility, plan removal in next major version.

### 6.2 `visual-translator.ts` — Deprecated hash functions

```ts
/** @deprecated Use generateDeterministicVisualHash */
export function generateVisualHash() { ... }
/** @deprecated Use generateStableCharacterRefUrl */
export function generateCharacterRefUrl() { ... }
```

Properly marked. The chain `generateVisualHash` → `generateCharacterRefUrl` is dead — neither has external callers beyond each other.

---

## 7. Priority-Ordered Action Plan

### 🔴 HIGH — Clean up (low risk, high signal-to-noise)

| File | Action | Lines to Remove |
|------|--------|----------------|
| `pattern-miner-enhanced.ts` | Remove unused imports `memoize`, `Instance` | 2 |
| `observability.ts` | Remove unused import `getNovelLanguageModel` | 1 |
| `visual-prompt-engineer.ts` | Remove unused import `generateDeterministicVisualHash` | 1 |
| `dynamic-prompt.ts` | Remove unused import `z` | 1 |
| `narrative-skeleton.ts` | Remove unused import `Instance` | 1 |
| `story-world-memory.ts` | Remove unused imports `Instance`, `CharacterState` | 2 |
| `story-knowledge-graph.ts` | Remove unused import `Instance` | 1 |
| `motif-tracker.ts` | Remove unused import `Instance` | 1 |
| `branch-storage.ts` | Remove unused import `Instance` | 1 |
| `procedural-world.ts` | Remove unused import `Instance` | 1 |
| `command-parser.ts` | Remove unused import `Instance` | 1 |
| `narrative-skeleton.ts` | Remove `createFallbackSkeleton` (never called) | ~30 |
| `visual-translator.ts` | Remove deprecated `generateVisualHash` + `generateCharacterRefUrl` | ~40 |
| `pattern-vector-index.ts` | **Delete entire file** | ~170 |
| `faction-detector.ts` | **Delete entire file** (superseded) | ~150 |

**Total:** ~11 unused imports + ~390 lines of dead code = **~400 lines removable**

### 🟡 MEDIUM — Dead exports (review and decide)

| Module | Dead Exports | Action |
|--------|-------------|--------|
| `llm-wrapper.ts` | `callLLMWithTracing`, `callLLMBatch`, `novelLLM` | Remove from barrel, keep as test utilities |
| `validation.ts` | All `*WithContext` functions, correlation | Remove from barrel, keep as test utilities |
| `performance.ts` | `rateLimit`, `throttle`, `batch`, `lazy`, cache utils | Remove from barrel, keep as test utilities |
| `command-parser.ts` | `isSlashCommand`, `listSkills` | Remove from barrel exports |

### 🟢 LOW — Incomplete integration (planned features)

| Item | Effort | Notes |
|------|--------|-------|
| Observability TODOs (5 items) | Medium | Wire faction detector, memory stats, inconsistency detection |
| `branch-storage.ts` embedding column | Low | Implement or remove |
| `state-extractor.ts` `FactValidator` | Low | Document or remove |
| `novel-learning-bridge.ts` | Medium | `NovelLearningBridgeManager` never instantiated — decide: integrate or archive |

---

## 8. Health Score by Module

| Module | Integration | Code Quality | Verdict |
|--------|-------------|--------------|---------|
| `orchestrator.ts` | ✅ Full | ✅ Clean | Core, healthy |
| `state-extractor.ts` | ✅ Full | ⚠️ FactValidator stub | Minor cleanup needed |
| `evolution-rules.ts` | ✅ Full | ✅ Clean | Healthy |
| `multiway-relationships.ts` | ✅ Full (after inertia filter) | ✅ Clean | Healthy |
| `multi-thread-narrative.ts` | ✅ Integrated | ✅ Clean | Healthy |
| `novel-config.ts` | ✅ Full | ✅ Clean | Healthy |
| `visual-orchestrator.ts` | ✅ Full | ⚠️ 2 dead exports | Minor cleanup |
| `visual-prompt-engineer.ts` | ✅ Full | ⚠️ 1 dead import | Minor cleanup |
| `visual-translator.ts` | ✅ Full | ⚠️ deprecated chain + 2 dead exports | Cleanup needed |
| `branch-manager.ts` | ✅ Partial | ⚠️ 6 dead exports | Review needed |
| `branch-storage.ts` | ✅ Partial | ⚠️ 4 dead exports + embedding column | Review needed |
| `character-deepener.ts` | ✅ Full | ✅ Clean | Healthy |
| `relationship-analyzer.ts` | ✅ Partial | ✅ Clean | Healthy |
| `story-knowledge-graph.ts` | ✅ Partial | ⚠️ 6 dead exports + detectInconsistency TODO | Review needed |
| `story-world-memory.ts` | ✅ Partial | ⚠️ 2 dead imports | Minor cleanup |
| `pattern-miner-enhanced.ts` | ✅ Full | ⚠️ 2 dead imports | Minor cleanup |
| `motif-tracker.ts` | ✅ Partial | ⚠️ 1 dead import + 1 dead export | Minor cleanup |
| `character-lifecycle.ts` | ✅ Partial | ⚠️ 1 dead export | Minor cleanup |
| `end-game-detection.ts` | ✅ Partial | ⚠️ 2 dead exports | Minor cleanup |
| `relationship-inertia.ts` | ✅ Partial | ⚠️ 2 dead exports | Minor cleanup |
| `procedural-world.ts` | ✅ Partial | ⚠️ 1 dead import + 5 dead exports | Review needed |
| `narrative-skeleton.ts` | ✅ Partial | ⚠️ 1 dead import + 7 dead exports | Review needed |
| `llm-wrapper.ts` | ✅ Partial | ⚠️ 3 dead exports | Review needed |
| `validation.ts` | ✅ Partial | ⚠️ 7 dead exports | Review needed |
| `performance.ts` | ✅ Partial | ⚠️ 7 dead exports | Review needed |
| `command-parser.ts` | ✅ Partial | ⚠️ 1 dead import + 2 dead exports | Minor cleanup |
| `observability.ts` | ✅ Partial | ⚠️ 1 dead import + 4 dead exports + 5 TODOs | Review needed |
| `model.ts` | ✅ Full | ✅ Clean | Healthy |
| `dynamic-prompt.ts` | ✅ Partial | ⚠️ 1 dead import + 1 dead export | Minor cleanup |
| `continuity-analyzer.ts` | ✅ Full | ✅ Clean | Healthy |
| `novel-learning-bridge.ts` | ⚠️ Not wired | ✅ Clean | **Decide: integrate or archive** |
| `pattern-vector-index.ts` | ❌ Orphan | ⚠️ All methods stubs | **DELETE** |
| `faction-detector.ts` | ❌ Replaced | ✅ Clean | **DELETE** |
