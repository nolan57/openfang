# Novel Engine - Dead Code Audit (Verified)

**Date:** 2026-04-07
**Last Updated:** 2026-04-07 — Phase 1/2 cleanup completed
**Method:** grep_search across all .ts files — every claimed caller verified with actual regex matches
**Verification:** Every import, every function call, every method invocation traced

---

## Status: Current

As of commit `ad8b2747d`, ~440 lines of dead code were removed from `visual-translator.ts`:
- ~~`enrichBeatWithVisuals()`~~ — ✅ Deleted
- ~~`translateStoryToPanels()`~~ — ✅ Deleted
- ~~`detectActionFromConfig()`~~ — ✅ Deleted
- ~~`ruleBasedPreSegmentation()`~~ — ✅ Moved to `visual-orchestrator.ts`

This audit reflects the **current** state of the codebase after that cleanup.

---

## Corrected Findings (vs Both Previous Analyses)

### Verification Results Table

| Claim | Previous Audit | Grep Verification | VERDICT |
|-------|---------------|-------------------|---------|
| `initVisualTranslator()` — zero callers | Dead | ❌ Only defined, **zero callers** | 🔴 **DEAD** (deleted in cleanup) |
| `enrichBeatWithVisuals()` — zero callers | Dead | ~~Only defined~~ | ✅ **DELETED** (ad8b2747d) |
| `translateStoryToPanels()` — zero callers | Dead | ~~Only defined~~ | ✅ **DELETED** (ad8b2747d) |
| `resolveVisualSpec()` — zero callers | Dead | ❌ Only in tests + TODO | 🔴 **DEAD** |
| `createNarrativeSkeleton()` called by orchestrator | Active | ✅ Called at orchestrator.ts:642 | 🟢 **ACTIVE** |
| `loadNarrativeSkeleton()` called by orchestrator | Active | ✅ Called at orchestrator.ts:627 | 🟢 **ACTIVE** |
| `validateGoalWithContext` — zero callers | Dead | ❌ Not imported anywhere | 🔴 **DEAD** |
| `validateTraumaWithContext` — zero callers | Dead | ❌ Not imported anywhere | 🔴 **DEAD** |
| `validateSkillWithContext` — zero callers | Dead | ❌ Not imported anywhere | 🔴 **DEAD** |
| `callLLMBatch` — test-only | Test-Only | ❌ Only in tests | 🟡 **TEST-ONLY** (removed from barrel) |
| `callLLMWithTracing` — zero callers | Dead | ❌ Only defined | 🔴 **DEAD** (removed from barrel) |
| `novelLLM` namespace — zero callers | Dead | ❌ Only defined | 🔴 **DEAD** (removed from barrel) |
| `BranchManager` used in orchestrator | Active | ✅ Fully integrated | 🟢 **ACTIVE** |
| `collectMetrics()` — test-only | Test-Only | ❌ Only in tests | 🟡 **TEST-ONLY** |
| `isSlashCommand`, `listSkills` — internal only | Internal | ❌ No external callers | 🔴 **REMOVED from barrel** |

---

## Visual Pipeline — Current Architecture

```
orchestrator.generateVisualPanels()
  │
  ├─ Phase 1: ruleBasedPreSegmentation()    ← visual-orchestrator.ts (规则分割)
  │    └→ planPanelSegments()               ← LLM 面板规划
  │
  ├─ Phase 2: buildPanelSpecWithHybridEngine()  ← visual-prompt-engineer.ts
  │    ├─ generateOptimizedVisuals()
  │    │    ├─ shouldUseLLM() → buildLLMPrompt()    ← LLM 路径
  │    │    └─ buildHardcodedPrompt()               ← 快速路径
  │    │
  │    └─ 调用 visual-translator.ts 工具函数:
  │         ├ translateEmotionToVisuals()     ✅ 情感→视觉
  │         ├ translateActionToCamera()       ✅ 动作→摄像机
  │         ├ selectLightingPreset()          ✅ 光照预设
  │         ├ selectStyleModifiers()          ✅ 风格修饰
  │         ├ selectAtmosphericEffects()      ✅ 大气效果
  │         ├ generateStableCharacterRefUrl() ✅ 角色引用URL
  │         ├ prioritizeAndTruncatePrompt()   ✅ 提示词截断
  │         ├ getShotSpecificNegatives()      ✅ 负向提示
  │         └ getMovementSpecificNegatives()  ✅ 运动负向
  │
  └─ assemblePanelSpec()                     ← visual-translator.ts (最终组装)
```

### `visual-translator.ts` Current State (732 lines)

| Export | Status | Notes |
|--------|--------|-------|
| `assemblePanelSpec()` | ✅ Active | Core panel assembly function |
| `assemblePanelSpecWithLLM()` | ✅ Active | LLM-enhanced assembly for complex scenes |
| `clearPanelCache()` | ✅ Active | Clear the LRU panel cache |
| `getPanelCacheStats()` | ✅ Active | Get cache statistics |
| `reloadVisualConfig()` | ✅ Active | Hot-reload visual configuration |
| `resetVisualTranslator()` | ✅ Active | Reset both config and panel cache |
| `translateEmotionToVisuals()` | ✅ Active | Emotion → visual mapping |
| `translateActionToCamera()` | ✅ Active | Action → camera mapping |
| `selectLightingPreset()` | ✅ Active | Lighting preset selection |
| `selectStyleModifiers()` | ✅ Active | Style modifier selection |
| `selectAtmosphericEffects()` | ✅ Active | Atmospheric effects |
| `generateStableCharacterRefUrl()` | ✅ Active | Deterministic character ref |
| `prioritizeAndTruncatePrompt()` | ✅ Active | Token-limited prompt building |
| `getShotSpecificNegatives()` | ✅ Active | Negative prompts by shot |
| `getMovementSpecificNegatives()` | ✅ Active | Negative prompts by movement |
| `isComplexEmotion()` | ✅ Active | Re-export from config |
| `isComplexAction()` | ✅ Active | Re-export from config |
| ~~`initVisualTranslator()`~~ | ✅ **Deleted** | Was zero callers, config lazy-loaded |
| ~~`generateDeterministicVisualHash()`~~ export | ✅ **Internal** | No longer exported, used only by `generateStableCharacterRefUrl()` |
| ~~`EnrichedBeat`~~ re-export | ✅ **Removed** | No consumers after `enrichBeatWithVisuals()` deletion |

---

## Verified Dead Code (Confirmed by grep_search)

### 🔴 Tier 1: Definitely Dead (zero callers in any .ts file)

| Function | File | Status |
|----------|------|--------|
| ~~`initVisualTranslator()`~~ | visual-translator.ts | ✅ **DELETED** in cleanup |
| `resolveVisualSpec()` | config/config-loader.ts | 🔴 Dead — only in tests + TODO |
| `reloadVisualConfig()` | config/config-loader.ts | 🔴 Dead — only definition + export |
| `clearConfigCache()` | config/config-loader.ts | 🔴 Dead — only definition + export |
| `validateGoalWithContext()` | validation.ts | 🔴 Dead |
| `validateTraumaWithContext()` | validation.ts | 🔴 Dead |
| `validateSkillWithContext()` | validation.ts | 🔴 Dead |
| `validateCharacterUpdateWithContext()` | validation.ts | 🔴 Dead |
| `validateRelationshipUpdateWithContext()` | validation.ts | 🔴 Dead |
| `callLLMWithTracing()` | llm-wrapper.ts | 🔴 Dead (removed from barrel) |
| `generateDenouementStructure()` | end-game-detection.ts | 🔴 Dead — only in tests |
| `getCriterionProgress()` | end-game-detection.ts | 🔴 Dead — only in tests |
| `exportToKnowledgeGraph()` | motif-tracker.ts | 🔴 Dead — only in tests |
| `getHooksForCharacters()` | relationship-inertia.ts | 🔴 Dead — only in tests |
| `getPlotHooksReport()` | relationship-inertia.ts | 🔴 Dead — only in tests |
| `submitFeedbackToMetaLearner()` | command-parser.ts | 🔴 Dead — stub only |
| `validateAnalysis()` | continuity-analyzer.ts | 🔴 Dead |
| `createFallbackSkeleton()` | narrative-skeleton.ts | 🔴 Dead |
| `generateNewCharacter()` | character-lifecycle.ts | 🔴 Dead |

### 🟡 Tier 2: Test-Only (callers exist only in .test.ts files)

| Function | Test Files |
|----------|-----------|
| `callLLMBatch()` | tests/llm-wrapper.test.ts |
| `collectMetrics()` | tests/observability.test.ts |
| `generateHealthReport()` | tests/observability.test.ts |
| `exportTraceData()` | None |
| `getErrorSummary()` | None |
| `getMetricsHistory()` | None |
| `getTraceEvents()` | None |
| `createCorrelationId()` | tests/validation.test.ts |
| `createCorrelationContext()` | tests/validation.test.ts |
| `clearMemoCache()` | tests/performance.test.ts |
| `deleteMemoKey()` | tests/performance.test.ts |
| `getMemoStats()` | tests/performance.test.ts |
| `rateLimit()` | tests/performance.test.ts |
| `throttle()` | tests/performance.test.ts |
| `batch()` | tests/performance.test.ts |
| `lazy()` | tests/performance.test.ts |

### ✅ Verified Active (confirmed callers in production code)

| Function | Caller File |
|----------|------------|
| `createNarrativeSkeleton()` | orchestrator.ts |
| `loadNarrativeSkeleton()` | orchestrator.ts |
| `getNextKeyBeat()` | orchestrator.ts |
| `getThematicMotifString()` | orchestrator.ts |
| `assemblePanelSpec()` | visual-prompt-engineer.ts |
| `translateEmotionToVisuals()` | visual-prompt-engineer.ts |
| `translateActionToCamera()` | visual-prompt-engineer.ts |
| `prioritizeAndTruncatePrompt()` | visual-prompt-engineer.ts |
| `generateStableCharacterRefUrl()` | visual-prompt-engineer.ts |
| `selectLightingPreset()` | visual-prompt-engineer.ts |
| `selectStyleModifiers()` | visual-prompt-engineer.ts |
| `selectAtmosphericEffects()` | visual-prompt-engineer.ts |
| `getShotSpecificNegatives()` | visual-prompt-engineer.ts |
| `getMovementSpecificNegatives()` | visual-prompt-engineer.ts |
| `isComplexEmotion()` | visual-prompt-engineer.ts |
| `isComplexAction()` | visual-prompt-engineer.ts |
| `debounce()` | orchestrator.ts |
| `withRetry()`, `RetryConfig` | llm-wrapper.ts |
| `motifTracker.analyzeMotifEvolution()` | orchestrator.ts |
| `relationshipInertiaManager.generatePlotHooks()` | orchestrator.ts |
| `relationshipInertiaManager.getActiveHooks()` | orchestrator.ts |
| `endGameDetector.checkCompletion()` | orchestrator.ts |
| `endGameDetector.updateStoryMetrics()` | orchestrator.ts |

---

## Barrel Export Cleanup

### Removed from `index.ts`

| Export | Reason |
|--------|--------|
| ~~`isSlashCommand`~~ | Internal-only, no external callers |
| ~~`listSkills`~~ | Internal-only, no external callers |
| ~~`callLLMBatch`~~ | Test-only |
| ~~`callLLMWithTracing`~~ | Zero production callers |
| ~~`novelLLM`~~ | Never imported externally |

### Remaining Barrel Exports (all actively used)

| Export | Source | Consumer |
|--------|--------|----------|
| `EvolutionOrchestrator`, `loadDynamicPatterns` | orchestrator.ts | CLI, external modules |
| `EnhancedPatternMiner` | pattern-miner-enhanced.ts | orchestrator.ts |
| `StateExtractor` | state-extractor.ts | orchestrator.ts |
| `BranchManager`, `BranchStorage` | branch-manager.ts, branch-storage.ts | orchestrator.ts |
| `CharacterLifecycleManager` | character-lifecycle.ts | orchestrator.ts |
| `EndGameDetector` | end-game-detection.ts | orchestrator.ts |
| `MotifTracker` | motif-tracker.ts | orchestrator.ts |
| `StoryKnowledgeGraph`, `StoryWorldMemory` | knowledge graph modules | orchestrator.ts |
| `WorldBibleKeeper`, `MultiArcArchitect` | narrative modules | orchestrator.ts |
| `callLLM`, `callLLMJson` | llm-wrapper.ts | Multiple modules |
| `memoize`, `debounce`, `throttle`, `batch`, `lazy`, `rateLimit` | performance.ts | Various |

---

## Final Recommendations

### Completed ✅
1. ~~Delete `initVisualTranslator`, `enrichBeatWithVisuals`, `translateStoryToPanels`~~ — ✅ Done
2. ~~Remove `EnrichedBeat` re-export from visual-translator~~ — ✅ Done
3. ~~Remove `generateDeterministicVisualHash` export~~ — ✅ Made internal
4. ~~Remove dead imports from visual-translator~~ — ✅ Done (`callLLMJson`, `getActionMapping`, `EmotionVisual`, `ActionMapping`)
5. ~~Remove barrel exports: `isSlashCommand`, `listSkills`, `callLLMBatch`, `callLLMWithTracing`, `novelLLM`~~ — ✅ Done

### Remaining 🔴
6. Delete `resolveVisualSpec`, `reloadVisualConfig`, `clearConfigCache` from config-loader.ts — zero production callers
7. Delete validation `*WithContext` functions — zero callers
8. Wire observability into orchestrator's `runNovelCycle()`
9. Delete unused singletons: `branchManager`, `relationshipViewService`, `asyncGroupManagementService`, `proceduralWorldGenerator`, `characterDeepener`, `relationshipAnalyzer`
