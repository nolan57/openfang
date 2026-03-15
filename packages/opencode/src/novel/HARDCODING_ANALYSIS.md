# Novel Engine Hardcoding Analysis Report

## Overview

This report analyzes all hardcoded content in the `packages/opencode/src/novel/` module and evaluates whether it should be dynamicized like the chaos table.

---

## Hardcoding Classification

### 1. Type and Category Constants ✅ Keep Hardcoded

**Location:** `types.ts`

```typescript
export const TRAUMA_TAGS = {
  VISUAL: "PTSD_Visual",
  NIGHTMARE: "PTSD_Nightmare",
  FLASHBACK: "PTSD_Flashback",
  PAIN: "Physical_Pain",
  // ... 20+ trauma types
}

export const SKILL_CATEGORIES = {
  ANALYSIS: "Mental_Analysis",
  DEDUCTION: "Mental_Deduction",
  // ... 20+ skill categories
}

export const CHARACTER_STATUS = {
  ACTIVE: "active",
  INJURED: "injured",
  STRESSED: "stressed",
  // ... 10+ statuses
}

export const ATTACHMENT_STYLES = {
  SECURE: "secure",
  ANXIOUS: "anxious",
  AVOIDANT: "avoidant",
  DISORGANIZED: "disorganized",
}
```

**Analysis:**

- ✅ **Should remain hardcoded**
- These are **data model schema definitions**
- Need to maintain consistency with database, UI, API
- LLM will reference these fixed values when generating content

**Suggestion:** Keep unchanged, but consider allowing LLM to extend new types

---

### 2. Prompt Templates ⚠️ Partially Dynamic

**Location:** `evolution-rules.ts`, `character-deepener.ts`, etc.

```typescript
// evolution-rules.ts
const STATE_CHANGE_EVALUATION_PROMPT = `You are a strict game master (GM) responsible for extracting state changes from story text.

Character State Rules:
- Skill Award: A character can only receive a new skill when they successfully overcome a specific and challenging obstacle.
- Trauma Trigger: A character receives trauma when experiencing life-threatening events...

Your task:
Analyze the story segment below. Identify ALL skill awards and trauma triggers following the rules above.

Output Format (strict JSON):
{
  "skill_awards": [...],
  "trauma_awards": [...]
}

Story Segment:
{{STORY_SEGMENT}}

Output only JSON, no other text.`
```

**Analysis:**

- ⚠️ **Partially needs dynamicization**
- Core rules should remain (skill/trauma acquisition rules)
- But prompt tone and style can adapt to story tone
- Currently static, doesn't consider story type (fantasy/sci-fi/romance, etc.)

**Suggested Improvement:**

```typescript
// Add dynamic prompt generator
async function buildStateEvaluationPrompt(storySegment: string, storyTone?: string, genre?: string): Promise<string> {
  const toneInstruction = storyTone
    ? `The story tone is "${storyTone}". Pay attention to events that match this tone.`
    : ""

  const genreInstruction = genre ? `This is a ${genre} story. Consider genre-appropriate skills and traumas.` : ""

  return `You are a strict game master...
  
${toneInstruction}
${genreInstruction}

Story Segment:
${storySegment}

...`
}
```

---

### 3. Weights and Scoring Formulas ⚠️ Make Configurable

**Location:** `branch-manager.ts`

```typescript
calculateBranchScore(branch: Branch): number {
  const weights = {
    narrativeQuality: 0.25,
    tensionLevel: 0.15,
    characterDevelopment: 0.20,
    plotProgression: 0.15,
    characterGrowth: 0.10,
    riskReward: 0.05,
    thematicRelevance: 0.10,
  }

  return (
    branch.evaluation.narrativeQuality * weights.narrativeQuality +
    branch.evaluation.tensionLevel * weights.tensionLevel +
    // ...
  )
}
```

**Analysis:**

- ⚠️ **Should be configurable**
- Currently weights are hardcoded
- Different story types may need different weights
  - Action stories: higher tensionLevel weight
  - Character-driven stories: higher characterDevelopment weight
  - Theme-driven stories: higher thematicRelevance weight

**Suggested Improvement:**

```typescript
interface ScoringConfig {
  weights: {
    narrativeQuality: number
    tensionLevel: number
    characterDevelopment: number
    plotProgression: number
    characterGrowth: number
    riskReward: number
    thematicRelevance: number
  }
  storyType?: "action" | "character" | "theme" | "balanced"
}

const PRESET_CONFIGS: Record<string, ScoringConfig> = {
  action: {
    weights: {
      narrativeQuality: 0.2,
      tensionLevel: 0.3, // Higher
      characterDevelopment: 0.15,
      // ...
    },
  },
  character: {
    weights: {
      characterDevelopment: 0.35, // Higher
      // ...
    },
  },
  balanced: {
    /* default weights */
  },
}
```

---

### 4. Thresholds and Limits ⚠️ Make Configurable

**Location:** Multiple files

```typescript
// evolution-rules.ts
private static readonly STRESS_THRESHOLD_CRITICAL = 90
private static readonly STRESS_THRESHOLD_HIGH = 70
private static readonly STRESS_DELTA_LARGE = 20
private static readonly DIFFICULTY_THRESHOLD_HIGH = 7

// branch-manager.ts
const DEFAULT_PRUNING_CONFIG: BranchPruningConfig = {
  maxBranches: 20,
  minQualityThreshold: 3,
  keepSelectedBranches: true,
  pruneAfterChapters: 5,
}

// pattern-vector-index.ts
const DEFAULT_CONFIG: VectorIndexConfig = {
  embeddingDimension: 1536,
  similarityThreshold: 0.7,
  maxResults: 10,
}
```

**Analysis:**

- ⚠️ **Should be configurable**
- Currently hardcoded constants
- Different users may prefer different difficulty/density
- Different story types need different thresholds

**Suggested Improvement:**

```typescript
interface NovelConfig {
  stressThresholds: {
    critical: number // Default 90
    high: number // Default 70
  }
  branchConfig: {
    maxBranches: number
    minQualityThreshold: number
  }
  difficulty: "easy" | "normal" | "hard" | "nightmare"
}

const DIFFICULTY_PRESETS: Record<string, NovelConfig> = {
  easy: {
    stressThresholds: { critical: 100, high: 80 }, // More lenient
    branchConfig: { maxBranches: 30, minQualityThreshold: 2 },
  },
  hard: {
    stressThresholds: { critical: 80, high: 60 }, // Stricter
    branchConfig: { maxBranches: 10, minQualityThreshold: 5 },
  },
}
```

---

### 5. Relationship Types and Dynamics ✅ Keep Hardcoded + LLM Extension

**Location:** `faction-detector.ts`, `relationship-analyzer.ts`

```typescript
export const FACTION_TYPES = [
  "alliance",
  "opposition",
  "neutral",
  "underground",
  "religious",
  "military",
  "political",
  "economic",
  "ideological",
  "familial",
  "cooperative",
]

export const RELATIONSHIP_TYPES = [
  "ally",
  "rival",
  "mentor",
  "lover",
  "enemy",
  // ...
]
```

**Analysis:**

- ✅ **Keep base types hardcoded**
- These are core data models
- But LLM should be able to recognize and create new subtypes

**Suggested Improvement:**

```typescript
// Base types hardcoded, LLM can extend subtypes
interface Relationship {
  type: RelationshipType  // Base type (hardcoded)
  subType?: string        // LLM-generated subtype
  description?: string    // LLM-generated description
}

// Example
{
  type: "ally",
  subType: "reluctant_ally",  // LLM generated
  description: "Allied due to common enemy, but distrustful"
}
```

---

### 6. Life Stages ⚠️ Can Be Dynamic

**Location:** `character-lifecycle.ts`

```typescript
export const CharacterLifeStageSchema = z.enum([
  "infant",
  "child",
  "adolescent",
  "young_adult",
  "adult",
  "middle_aged",
  "elder",
  "ancient",
])
```

**Analysis:**

- ⚠️ **May be insufficient for fantasy/sci-fi stories**
- Modern/realistic stories: current settings sufficient
- Fantasy stories: may need "magical_child", "ascended", "undead", etc.
- Sci-fi stories: may need "cyborg", "digital_consciousness", "cloned", etc.

**Suggested Improvement:**

```typescript
// Keep base stages, but allow LLM to extend
const BASE_LIFE_STAGES = [
  "infant", "child", "adolescent",
  "young_adult", "adult", "middle_aged",
  "elder", "ancient",
]

interface CharacterLifecycle {
  baseStage: LifeStage  // Base stage (hardcoded)
  modifiedStage?: string  // LLM-generated variant
  stageDescription?: string  // LLM description
}

// Example
{
  baseStage: "adult",
  modifiedStage: "cursed_immortal_adult",
  stageDescription: "Physically adult but cursed with immortality"
}
```

---

### 7. Story Types and Tones 🔲 Fully Dynamic

**Current Location:** Not explicitly defined, scattered throughout

**Analysis:**

- 🔲 **Should be fully determined by LLM**
- Currently no explicit story type/tone configuration
- This should be fully determined by user input and LLM analysis

**Suggested Implementation:**

```typescript
interface StoryProfile {
  genre: string // LLM analyzed
  tone: string // LLM analyzed
  themes: string[] // LLM analyzed
  targetAudience: string // LLM analyzed
  contentRating: string // LLM analyzed
}

async function analyzeStoryProfile(
  initialPrompt: string,
  userPreferences?: Partial<StoryProfile>,
): Promise<StoryProfile> {
  // Call LLM to analyze story type and tone
  // Used to adjust all subsequent generation style
}
```

---

## Summary and Recommendations

### Keep Hardcoded (✅)

| Item                    | Reason                                   |
| ----------------------- | ---------------------------------------- |
| Data type definitions   | Need consistency with database, API, UI  |
| Schema validation       | Zod schemas need fixed structure         |
| Core relationship types | Base categories, LLM can extend subtypes |

### Make Configurable (⚠️)

| Item              | Suggestion                                |
| ----------------- | ----------------------------------------- |
| Scoring weights   | Preset configurations by story type       |
| Threshold limits  | Preset configurations by difficulty level |
| Life cycle stages | Base + LLM extension variants             |

### Fully Dynamic (🔲)

| Item                   | Suggestion                             |
| ---------------------- | -------------------------------------- |
| Prompt style           | Dynamically adjust based on story tone |
| Story type/tone        | Fully analyzed by LLM                  |
| Specific events        | Completed (chaos table)                |
| Character/plot details | Fully generated by LLM                 |

---

## Priority Ranking

| Priority  | Item                         | Effort | Impact |
| --------- | ---------------------------- | ------ | ------ |
| 🔴 High   | Dynamic prompt generator     | Medium | High   |
| 🟡 Medium | Configurable scoring weights | Low    | Medium |
| 🟡 Medium | Configurable thresholds      | Low    | Medium |
| 🟢 Low    | Life cycle extension         | Medium | Low    |
| 🟢 Low    | Relationship subtypes        | Low    | Low    |

---

## Next Steps

1. **Implement dynamic prompt generator** - Adjust prompt style based on story tone
2. **Add difficulty configuration** - easy/normal/hard/nightmare presets
3. **Add story type presets** - action/character/theme scoring weight presets
4. **Keep core data models** - Type definitions remain hardcoded

---

_Report generated on 2026-03-15_
_Novel Engine Hardcoding Analysis_
