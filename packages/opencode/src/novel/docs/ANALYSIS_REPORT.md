# Novel Engine - Dead Code & Integration Analysis Report

**Date:** 2026-04-03
**Scope:** All 47 files in `/packages/opencode/src/novel/`
**Method:** Import graph analysis, call chain tracing, export consumption analysis

---

## Executive Summary

| Category | Count | Files |
|----------|-------|-------|
| **Fully Wired (healthy)** | 28 | Core pipeline modules |
| **Dead Imports (minor)** | 4 | Unused `import` statements within files |
| **Dead Functions (minor)** | 3 | Defined but never called internally |
| **Unintegrated Modules (major)** | 2 | Complete modules not wired into orchestrator |
| **Deprecated/Backward Compat** | 3 | Kept for compatibility, safe to remove later |
| **Stub/Incomplete Features** | 2 | Partially implemented features |

---

## 1. External Consumer Map

The novel engine is consumed by these external modules:

| Consumer | Imports | Purpose |
|----------|---------|---------|
| `cli/cmd/novel.ts` | `EvolutionOrchestrator`, `loadDynamicPatterns`, `enhancedPatternMiner`, `loadLayeredConfig`, `extractConfigFromPrompt` | **Primary entry point** - CLI commands |
| `index.ts` | `NovelCommand` | Registers CLI command |
| `evolution/skill.ts` | `getNovelLanguageModel` | AI model for skill evolution |
| `evolution/prompt.ts` | `getNovelLanguageModel` | AI model for prompt evolution |
| `learning/critic.ts` | `getNovelLanguageModel` | AI model for critic evaluation |
| `learning/consistency-checker.ts` | `getNovelLanguageModel` | AI model for consistency checking |
| `middleware/state-auditor.ts` | `CharacterState`, `StoryBible` (types only) | Type definitions |

**Key insight:** `getNovelLanguageModel` is the most reused export (4 external consumers). `EvolutionOrchestrator` is only used by the CLI command.

---

## 2. Dead Imports (unused `import` statements)

### 2.1 `pattern-miner-enhanced.ts` — `memoize` and `Instance`
```ts
import { memoize } from "./performance"       // ❌ NEVER USED
import { Instance } from "../project/instance" // ❌ NEVER USED
```
- **Action:** Remove both imports. `memoize` was likely planned for caching pattern extraction but never applied.

### 2.2 `observability.ts` — `getNovelLanguageModel` and `generateText`
```ts
import { getNovelLanguageModel } from "./model"  // ❌ NEVER USED
import { generateText } from "ai"                 // ❌ NEVER USED
```
- **Action:** Remove both imports. Likely leftover from a planned LLM-based health scoring feature.

### 2.3 `branch-storage.ts` — `BranchEvent` (exported but unused)
```ts
export interface BranchEvent { ... }  // ❌ Never consumed anywhere
```
- **Action:** Remove export. The type is defined but no code creates or consumes `BranchEvent` objects.

### 2.4 `state-extractor.ts` — `FactValidator` hook
```ts
interface FactValidator {
  validateExtractedState(updates: any, currentState: any): Promise<FactValidationReport>
}
declare global {
  var factValidator: FactValidator | undefined
}
```
- **Status:** Extension point that is never populated. The `applyFactValidationCorrections()` method checks for `globalThis.factValidator` but it's always `undefined`.
- **Action:** Keep as documented extension point, but add a comment noting it's not wired. Or remove if the external validation service is not planned.

---

## 3. Dead Functions (defined but never called)

### 3.1 `continuity-analyzer.ts` — `validateAnalysis()`
- **Status:** Private method defined but never invoked within the file.
- **Action:** Remove or integrate into the `analyze()` flow.

### 3.2 `command-parser.ts` — `submitFeedbackToMetaLearner()`
- **Status:** Stub function that only does `console.log`. Called by `/feedback` command but does nothing.
- **Action:** Either implement the feedback submission or remove the `/feedback` command.

### 3.3 `command-parser.ts` — `/plugin` command (start/stop)
- **Status:** The `/plugin` command has `start` and `stop` subcommands that print "not implemented".
- **Action:** Remove unimplemented subcommands or implement them.

---

## 4. Unintegrated Modules (NOT wired into orchestrator)

### 4.1 `pattern-vector-index.ts` — ⚠️ ORPHAN MODULE

**Status:** Complete module with full CRUD API, but **zero callers** outside its test file.

**Evidence:**
- Not imported by `orchestrator.ts`
- Not imported by `command-parser.ts`
- Not imported by `cli/cmd/novel.ts`
- Only imported by `tests/pattern-vector-index.test.ts`
- All query methods (`getPatternsByType`, `getTopPatterns`, `getStats`) return empty/zero
- `updateStrength` and `removePattern` are hardcoded to return `false`

**Design intent:** Thin wrapper around `NovelVectorBridge` for pattern vector search. The bridge delegates to the OpenCode learning system's vector store.

**Recommendation: INTEGRATE or DISCARD**
- **If integrating:** Wire into `orchestrator.ts` — call `indexPattern()` after each `enhancedPatternMiner.onTurn()`, and expose a CLI command `/search-patterns` that calls `searchSimilar()`.
- **If discarding:** Delete the file. The `NovelVectorBridge` already provides the same functionality, and the orchestrator could call it directly. This wrapper adds no value beyond a thin delegation layer that nobody calls.

### 4.2 `multi-thread-narrative.ts` — ⚠️ ORPHAN MODULE

**Status:** Sophisticated 1203-line module with circuit breakers, semantic conflict detection, LLM arbitration, and thread merging. **Never invoked** by the orchestrator.

**Evidence:**
- Not imported by `orchestrator.ts`
- Not imported by `command-parser.ts`
- Not imported by `cli/cmd/novel.ts`
- Only imported by `tests/phase5.test.ts`
- Exports `MultiThreadNarrativeExecutor` class with full API

**Design intent:** Enable parallel story thread generation (e.g., simultaneous POV narratives) with automatic conflict detection and reconciliation.

**Recommendation: INTEGRATE (high value)**
- This is a feature-rich module that deserves integration.
- **Integration points needed:**
  1. Add `multiThreadEnabled` config option to `NovelEngineConfig`
  2. In `orchestrator.ts`, after story generation, check if multi-thread is enabled
  3. Create threads via `createThread()` for each active storyline
  4. Call `executeAllThreads()` to advance all threads in parallel
  5. Use `mergeThreads()` to reconcile before saving state
  6. Add CLI command `/threads` to manage threads
- **Estimated effort:** Moderate — the module is self-contained and well-designed. Needs orchestrator wiring and config.

---

## 5. Deprecated / Backward Compatibility Code

### 5.1 `types.ts` — Deprecated constant aliases
```ts
/** @deprecated Use getTraumaTags() */
export const TRAUMA_TAGS = DEFAULT_TRAUMA_TAGS

/** @deprecated Use getSkillCategories() */
export const SKILL_CATEGORIES = DEFAULT_SKILL_CATEGORIES

/** @deprecated Use getCharacterStatus() */
export const CHARACTER_STATUS = DEFAULT_CHARACTER_STATUS
```
- **Status:** Properly marked `@deprecated`. The getter functions (`getTraumaTags()`, etc.) are the preferred API.
- **Action:** Keep for now. These are used by external code that hasn't migrated yet. Plan removal in next major version.

### 5.2 `visual-translator.ts` — Deprecated hash functions
```ts
/** @deprecated Use generateDeterministicVisualHash */
export function generateVisualHash() { ... }

/** @deprecated Use generateStableCharacterRefUrl */
export function generateCharacterRefUrl() { ... }
```
- **Status:** Properly deprecated. New versions are used by `visual-prompt-engineer.ts`.
- **Action:** Keep for backward compatibility. Safe to remove after confirming no external consumers.

---

## 6. Stub / Incomplete Features

### 6.1 `multiway-relationships.ts` — `_relationshipsFromState()` stub

```ts
private _relationshipsFromState(): Map<string, number> {
  // Returns map of zeros
  // Note: "orchestrator injects actual relationships"
}
```
- **Status:** Stub that returns all zeros. The actual relationship data comes from the `GraphReader` injected by the orchestrator.
- **Assessment:** This is intentional design — the service is read-only and relies on injected data. Not a bug.
- **Action:** No action needed. Consider renaming to make the stub nature clearer.

### 6.2 `branch-storage.ts` — `enableEmbeddings` config and `embedding` column

```ts
// In schema:
embedding: text().notNull().default('')  // Column exists but never populated
```
- **Status:** Database column exists, config option exists, but no code writes embeddings.
- **Action:** Either implement embedding generation (use vector store from learning system) or remove the column and config option.

---

## 7. Call Chain Summary

### Main Story Generation Pipeline (fully wired)

```
cli/cmd/novel.ts
  └── EvolutionOrchestrator
        ├── loadState() → story_bible.json
        ├── ensureNarrativeSkeleton()
        │     ├── createNarrativeSkeleton() → LLM
        │     └── ensureProceduralWorld() → ProceduralWorldGenerator
        ├── runNovelCycle()
        │     ├── evolutionRules.rollChaos() → 2d6 dice
        │     ├── evolutionRules.generateChaosEventWithLLM() → LLM
        │     ├── callLLM() → story text generation
        │     ├── stateExtractor.extract() → LLM state extraction
        │     │     └── validateRawStateUpdateWithWorldContext() → validation.ts
        │     ├── characterDeepener.deepenAllCharacters() → LLM
        │     ├── relationshipAnalyzer.analyzeAllRelationships() → LLM
        │     ├── enhancedPatternMiner.onTurn() → LLM pattern extraction
        │     ├── motifTracker.analyzeMotifEvolution() → LLM
        │     ├── relationshipInertiaManager.generatePlotHooks() → LLM
        │     ├── factionDetector.detectFactions()
        │     ├── characterLifecycleManager.advanceTime()
        │     ├── endGameDetector.checkCompletion()
        │     ├── analyzeRelationshipInstability() → RelationshipViewService
        │     ├── generateAndSaveVisualPanels()
        │     │     ├── visual-prompt-engineer.buildPanelSpecWithHybridEngine()
        │     │     │     └── visual-translator.assemblePanelSpec()
        │     │     └── continuity-analyzer.analyze() → LLM
        │     ├── runThematicReflection() → LLM (every N turns)
        │     └── saveState() → story_bible.json
        └── initializeLearningBridge() → NovelLearningBridgeManager
```

### External Model Usage (getNovelLanguageModel)

```
novel/model.ts → getNovelLanguageModel()
  ├── evolution/skill.ts     → skill evolution text generation
  ├── evolution/prompt.ts    → prompt optimization text generation
  ├── learning/critic.ts     → critic evaluation
  └── learning/consistency-checker.ts → consistency checking
```

---

## 8. Action Items by Priority

### 🔴 HIGH — Orphan Modules

| Module | Action | Effort | Rationale |
|--------|--------|--------|-----------|
| ~~`multi-thread-narrative.ts`~~ | ✅ **INTEGRATED** | Done | Wired into orchestrator with config flag, CLI flags, and barrel exports |
| `pattern-vector-index.ts` | **DISCARD** | Low | Redundant with NovelVectorBridge, all methods are stubs, no callers |

### 🟡 MEDIUM — Dead Code Cleanup

| File | Issue | Action |
|------|-------|--------|
| `pattern-miner-enhanced.ts` | Dead imports (`memoize`, `Instance`) | Remove |
| `observability.ts` | Dead imports (`getNovelLanguageModel`, `generateText`) | Remove |
| `branch-storage.ts` | Unused export (`BranchEvent`) | Remove |
| `continuity-analyzer.ts` | Dead function (`validateAnalysis`) | Remove |
| `command-parser.ts` | Stub function (`submitFeedbackToMetaLearner`) | Implement or remove `/feedback` |
| `command-parser.ts` | Unimplemented `/plugin` subcommands | Remove or implement |

### 🟢 LOW — Technical Debt

| File | Issue | Action |
|------|-------|--------|
| `types.ts` | Deprecated aliases (`TRAUMA_TAGS`, etc.) | Keep, plan removal in next major |
| `visual-translator.ts` | Deprecated hash functions | Keep, plan removal |
| `branch-storage.ts` | `embedding` column never populated | Implement or remove |
| `state-extractor.ts` | `FactValidator` extension point never wired | Document or remove |
| `multiway-relationships.ts` | `_relationshipsFromState()` stub | Intentional, rename for clarity |

---

## 9. Architecture Health Assessment

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Core Pipeline Integrity** | ✅ Healthy | All main flow modules are wired and functional |
| **External API Surface** | ✅ Healthy | `getNovelLanguageModel` widely reused, barrel exports clean |
| **Configuration System** | ✅ Healthy | Layered config with clear priority chain |
| **Visual Generation** | ✅ Healthy | Hybrid engine with LLM + hardcoded fallback |
| **Database Layer** | ⚠️ Partial | Embedding columns exist but unused |
| **Module Completeness** | ⚠️ Partial | 2 orphan modules, several stubs |
| **Code Hygiene** | ⚠️ Partial | ~10 dead imports/functions across files |
| **Test Coverage** | ✅ Adequate | 15 test files covering core and advanced modules |

---

## 10. Recommended Next Steps

1. ~~Immediate (low risk):~~ Clean up dead imports/functions in 6 files (~30 lines total)
2. ~~Short term:~~ Decide on `pattern-vector-index.ts` — integrate or delete
3. ~~Medium term:~~ ✅ **DONE** — Integrate `multi-thread-narrative.ts` into orchestrator with config flag
4. Long term: Implement embedding generation for `branch-storage.ts` or remove the column

---

## 12. Relationship Inertia Filter (Completed)

### Problem
The old `detectTriads` treated all "unstable" triads equally — a chronic enemy pair (consistently low trust for 20 chapters) received the same alert intensity as a sudden betrayal between lifelong allies. This produced false-positive drama and wasted LLM attention.

### Solution: Inertia Filter + Dynamic Intervention

**Concept:** Distinguish "stable instability" (expected) from "deviation" (noteworthy).

**`multiway-relationships.ts` changes:**

#### 1. Extended Interfaces
Added to `TriadPattern` and `GroupDynamicsResult`:
- `baselineStability` (0-100): Historical average stability over the past 5 chapters
- `deviationScore` (0-100): `Math.abs(currentStability - baselineStability)`
- `interventionLevel`: `"nudge" | "warning" | "critical"`

#### 2. Historical Baseline via `GraphReader.getRelationshipHistory()`
- Extended `GraphReader` interface with optional `getRelationshipHistory(charA, charB, fromChapter, toChapter)`
- Orchestrator's GraphReader implements it by scanning `branchHistory` and current state
- Falls back to current value when no history exists (early chapters)

#### 3. `_calculateTriadStability()` — new private method
Maps raw trust values (-100 to 100) to a 0-100 stability scale, with agreement bonus when all three edges share the same sign.

#### 4. `_calculateInterventionLevel()` — rule engine
```
critical: deviationScore > 60 AND currentStability < 20
warning:  deviationScore > 40 AND currentStability < 50
nudge:    deviationScore > 20
```

#### 5. `_generateTriadDescriptionWithIntervention()` — contextual descriptions
- **Critical:** "⚠️ CRITICAL: Catastrophic collapse in A ↔ B ↔ C! ..."
- **Warning:** "Unusual friction between A, B, and C. Their dynamic is shifting..."
- **Nudge:** Standard descriptions with mild tension notes

**`orchestrator.ts` changes:**

#### 1. Triad filtering by deviation
Changed from `pattern === "unstable" || pattern === "competitive"` to `deviationScore > 10` — only surface triads that actually deviate from their baseline.

#### 2. Tiered prompt injection
```
CRITICAL — MUST: [description]    (forces LLM attention)
WARNING  — SHOULD: [description]   (strongly suggests attention)
BACKGROUND — [description]          (subtle atmosphere, no pressure)
```

#### 3. Chaos event injection
Added `relationshipInstability` field to chaos context, consumed by `evolution-rules.ts`'s `generateChaosEventWithLLM()` which now includes the instability as a `RELATIONSHIP_INSTABILITY` prompt section.

### Example Scenario

| Scenario | Baseline | Current | Deviation | Level | Why |
|----------|----------|---------|-----------|-------|-----|
| Lifelong enemies stay enemies | 15 | 12 | 3 | nudge | No deviation — expected behavior |
| Allies suddenly distrust each other | 85 | 30 | 55 | **warning** | Significant shift from norm |
| Best friends become mortal enemies | 90 | 10 | 80 | **critical** | Catastrophic deviation — narrative emergency |
| Rivals become slightly friendlier | 25 | 40 | 15 | nudge | Minor positive fluctuation |

### Verification
- Type check: ✅ passes
- Tests: ✅ 232 pass (same pre-existing 2 failures in learning-bridge)

---

## 13. Multi-Thread Integration Details (Completed)

**1. Orchestrator changes (`orchestrator.ts`):**
- Added import for `MultiThreadNarrativeExecutor`, `NarrativeThread`, `MultiThreadConfig`
- Extended `OrchestratorConfig` interface with `multiThreadEnabled` and `multiThreadConfig`
- Added private fields: `multiThreadNarrative` (instance) and `multiThreadEnabled` (boolean)
- Constructor initializes the executor when `multiThreadEnabled: true`
- Added `executeMultiThreadCycle()` — called each chapter after advanced modules
- Added `ensureMultiThreadSetup()` — auto-creates threads from narrative skeleton story lines
- Added `extractPovCharacter()` — maps story line names to character names
- Added `getMultiThreadNarrative()` and `isMultiThreadEnabled()` public accessors

**2. CLI changes (`cli/cmd/novel.ts`):**
- Added `--multi-thread` flag (boolean, default: false)
- Added `--multi-thread-max-threads` flag (number, default: 5)
- Available on both `novel start` and `novel continue` commands

**3. Barrel export (`index.ts`):**
- Exports `MultiThreadNarrativeExecutor`, `multiThreadNarrativeExecutor`, and all related types

### How it works

```
runNovelCycle()
  └── [after advanced modules]
        └── executeMultiThreadCycle()
              ├── ensureMultiThreadSetup()     ← creates threads from skeleton
              ├── advanceThread() for each     ← advances with story data
              ├── conflict detection (auto)    ← LLM semantic analysis
              └── circuit breaker check        ← graceful degradation
```

### Usage

```bash
# Enable multi-thread mode
opencode novel start prompt.md --multi-thread

# With custom thread limit
opencode novel start prompt.md --multi-thread --multi-thread-max-threads 3

# Continue with multi-thread
opencode novel continue --multi-thread
```

### Safety

- Multi-thread mode is **off by default** — zero impact on existing stories
- All multi-thread code is wrapped in try/catch — failures don't break the main pipeline
- Circuit breaker prevents LLM failures from cascading
- Falls back to single-thread behavior when no threads exist

---

## 14. Pattern Mining → Story Generation Feedback Loop (Completed)

### Problem
The pattern miner extracted archetypes, motifs, and plot templates, but these results were **never injected back into the story generation prompt**. The feedback loop was broken:

```
Before:  Story → Pattern Mining → Save to Disk → 🛑 End (no influence on next chapter)
```

### Solution: Closed the feedback loop

**1. New `buildPatternContext()` method in orchestrator:**
- Gathers active archetypes (mythic character roles)
- Gathers active motifs (recurring imagery, symbols, themes)
- Gathers active plot templates (structural patterns with current stage beats)
- Formats them as a structured context block for the LLM prompt

**2. Injected into `generateWithLLM` userPrompt:**
```
${skeletonContext}${patternContext}
=== RETRIEVED MEMORY CONTEXT ===
```

**3. Updated systemPrompt rules:**
- "EMBODY the active character archetypes — let characters fulfill their mythic roles"
- "REINFORCE the active narrative motifs — weave recurring imagery, symbols, and themes throughout"
- "Follow the active plot template stages for structural coherence"

**4. Injected into chaos event context:**
- `activeMotifs`: Chaos event should AMPLIFY or SUBVERT active motifs
- `activeArchetypes`: Chaos event should TEST character archetypes

**5. Updated `evolution-rules.ts` `generateChaosEventWithLLM`:**
- Added `activeMotifs` and `activeArchetypes` fields to context type
- Added prompt sections for motif amplification/subversion and archetype testing

### Result
```
After:  Story → Pattern Mining → Prompt Injection → Influenced Next Chapter
```

Now when archetypes like "The Orphan (林墨, seeking father)" or motifs like "红色数据流 (red data stream)" are mined, they get injected into subsequent chapter prompts, causing the LLM to reinforce and evolve these elements throughout the narrative.

### Verification
- Type check: ✅ passes
- Tests: ✅ 217 pass (same pre-existing 2 failures in learning-bridge)
