# Novel Module - Panel Generation Methods

This document provides a comprehensive overview of the panel generation system in the novel module.

## Overview

The novel module's panel generation system creates visual panel specifications from story segments. It uses a hybrid architecture combining LLM-based creativity with hardcoded rules for speed and reliability.

## Core Files

| File                        | Purpose                               |
| --------------------------- | ------------------------------------- |
| `visual-orchestrator.ts`    | Main entry point, orchestration logic |
| `visual-prompt-engineer.ts` | Hybrid prompt engine (LLM + rules)    |
| `visual-translator.ts`      | Visual translation layer              |
| `config/config-loader.ts`   | Configuration system                  |
| `types.ts`                  | Type definitions                      |

---

## Primary Export Functions

### From `visual-orchestrator.ts`

#### `generateVisualPanels()`

```typescript
export async function generateVisualPanels(
  input: VisualGenerationInput,
  options: VisualOrchestratorOptions = {},
): Promise<VisualPanelSpec[]>
```

**Purpose**: Generate an array of visual panel specifications from a story segment.

**Features**:

- Splits story into segments for multiple panels
- Supports character-based and scene-only panels (fallback when no characters)
- Uses hybrid engine with LLM + hardcoded fallback
- Returns array of `VisualPanelSpec` objects

---

#### `generateAndSaveVisualPanels()`

```typescript
export async function generateAndSaveVisualPanels(
  input: VisualGenerationInput,
  options: VisualOrchestratorOptions = {},
): Promise<{ panels: VisualPanelSpec[]; savedPath: string | null }>
```

**Purpose**: Convenience function that generates AND saves panels to disk.

**Returns**: Object containing generated panels and the file path where they were saved.

---

#### `saveVisualPanels()`

```typescript
export async function saveVisualPanels(panels: VisualPanelSpec[], chapterCount: number): Promise<string | null>
```

**Purpose**: Save visual panels to a JSON file in the `panels/` directory.

**Returns**: The file path where panels were saved, or `null` if save failed.

---

## Hybrid Prompt Engine

### From `visual-prompt-engineer.ts`

#### `initVisualPromptEngineer()`

```typescript
export async function initVisualPromptEngineer(): Promise<void>
```

Initialize the engine with configuration.

---

#### `buildPanelSpecWithHybridEngine()`

```typescript
export async function buildPanelSpecWithHybridEngine(
  context: VisualGenerationContext,
  panelIndex: number,
): Promise<{ panel: VisualPanelSpec; detectedAction: string }>
```

**Purpose**: Main hybrid engine entry point for building individual panel specs.

**Decision Flow**:

1. **Fast Path**: Uses hardcoded rules from config (default)
2. **Slow Path**: Invokes LLM for complex scenes based on:
   - Complex emotions (e.g., "bittersweet", "conflicted")
   - Complex actions (e.g., "fight choreography", "dance")
   - Long descriptions (> token threshold)
   - Style blends requiring artistic judgment
   - Continuity needs with previous panels
3. **Fallback**: If LLM fails or low confidence → hardcoded rules

---

#### `generateOptimizedVisuals()`

```typescript
export async function generateOptimizedVisuals(
  context: VisualGenerationContext,
): Promise<LLMPromptEngineeringResult & { generationMethod: string }>
```

**Purpose**: Configuration-driven visual optimization with strategy resolution.

---

## Visual Translation Layer

### From `visual-translator.ts`

#### `translateEmotionToVisuals()`

```typescript
export function translateEmotionToVisuals(
  emotion: string,
  intensity: number = 0.5,
  psychologicalProfile?: PsychologicalProfile,
): { expression: string; bodyLanguage: string; facialFeatures: string }
```

**Purpose**: Map character emotions to visual expressions.

**Advanced Features**:

- Psychological profile integration (attachment styles: avoidant, anxious)
- Intensity-based modulation of expressions
- Body language customization based on personality

---

#### `translateActionToCamera()`

```typescript
export function translateActionToCamera(
  action: string,
  context: string = "",
  currentTheme?: string,
): { camera: Partial<CameraSpec>; lighting: string; composition: string }
```

**Purpose**: Translate narrative actions to camera specifications.

**Features**:

- Theme-aware camera work (betrayal themes add dramatic lighting, romance adds soft framing)
- Context-sensitive composition choices
- Dynamic lighting based on time of day and mood

---

#### `assemblePanelSpec()`

```typescript
export function assemblePanelSpec(input: PanelSpecInput): VisualPanelSpec
```

**Purpose**: Assemble complete `VisualPanelSpec` from component parts.

**Handles**:

- Camera specification from action
- Lighting from time/atmosphere
- Deterministic hashing for character consistency
- Priority-based prompt truncation

---

#### `assemblePanelSpec()`

```typescript
export function assemblePanelSpec(input: PanelSpecInput): VisualPanelSpec
```

**Purpose**: Assemble complete `VisualPanelSpec` from component parts.

**Handles**:

- Camera specification from action
- Lighting from time/atmosphere
- Deterministic hashing for character consistency
- Priority-based prompt truncation
- **Panel Cache**: LRU cache with deterministic content hashing (see below)

---

#### `assemblePanelSpecWithLLM()`

```typescript
export async function assemblePanelSpecWithLLM(
  input: PanelSpecInput,
  options?: { forceEnhancement?: boolean; minConfidence?: number },
): Promise<VisualPanelSpec>
```

**Purpose**: Assemble panel spec with optional LLM enhancement for complex scenes.

**Complex Scene Detection** (auto-triggers LLM):
- 3+ characters on screen with distinct emotions
- Complex/abstract emotion types (e.g., "bittersweet", "conflicted")
- High emotion intensity (≥ 0.8)
- Complex action types (fight choreography, dance, etc.)
- Theme-driven generic actions (betrayal, redemption, mystery themes)

**Behavior**:
1. Builds rule-based spec first (fast path)
2. For complex scenes, invokes LLM to validate and enhance composition
3. Applies LLM suggestions only if confidence ≥ threshold
4. Falls back to rule-based if LLM confidence is low
5. Caches all results to avoid duplicate generation

---

## Visual Panel Cache

The visual translator implements an **LRU cache** for assembled panel specs.

**Cache Key**: Deterministic hash of panel input parameters (panelIndex, beatText, characters, emotion, action, location, timeOfDay, tone, style).

**Configuration** (in `visual-config.json`):
```json
{
  "cache": {
    "max_size": 256,
    "ttl_ms": 1800000
  }
}
```

**Manual Control via CLI**:
- `/reload cache` — Clear the panel cache
- `/reload stats` — Show cache statistics (entries / max size)
- `/reload visual` — Reload config AND clear cache

**Programmatic Control**:
```typescript
import { clearPanelCache, getPanelCacheStats } from "./visual-translator"
clearPanelCache()                    // Clear all cached panels
const stats = getPanelCacheStats()   // { size: 42, maxSize: 256 }
```

---

## Configuration System

### From `config/config-loader.ts`

**Config Files**:

- `visual-config.json` - Main configuration (18KB)
- `visual-config.schema.json` - Zod validation schema
- `novel-config.json` - Novel-specific settings

### Current Strategy (v3)

The visual system uses a **configuration-driven** approach:

1. **Base Layer**: Default emotion/action mappings from `visual-config.json`
2. **Theme Adjustments**: Context-aware overrides for tension level and motifs
3. **Conflict Resolution**: Removes contradictory terms (e.g., "warm" vs "cold")

> **Note:** `resolveVisualSpec()` was a sophisticated layered override + voting system that was designed but never wired into production. The current `visual-prompt-engineer.ts` hybrid engine handles these cases through simpler config lookups and LLM fallback.

---

## Type Definitions

### From `types.ts`

#### `VisualPanelSpec` Interface

```typescript
export interface VisualPanelSpec {
  id: string
  panelIndex: number
  camera: CameraSpec
  lighting: string
  composition: string
  visualPrompt: string
  negativePrompt: string
  controlNetSignals: {
    poseReference: string | null
    depthReference: string | null
    characterRefUrl: string | null
  }
  styleModifiers: string[]
  colorPalette?: string[]
  atmosphericEffects?: string[]
  notes?: string
  promptVersion?: string
  hashStrategy?: string
}
```

#### `CameraSpec` Interface

```typescript
export interface CameraSpec {
  shot: string // e.g., "medium", "close-up", "wide"
  angle: string // e.g., "eye-level", "low-angle", "bird's-eye"
  movement: string // e.g., "static", "pan", "dolly"
  depthOfField: string // e.g., "shallow", "deep"
}
```

---

## Integration in Orchestrator

### From `orchestrator.ts` (lines 1298-1352)

```typescript
// Generate visual panels using dedicated visual orchestrator (if enabled)
if (this.visualPanelsEnabled) {
  const visualInput: VisualGenerationInput = {
    storySegment,
    characters: this.storyState.characters,
    narrativeSkeleton: this.storyState.narrativeSkeleton,
    chapterCount: this.storyState.chapterCount,
    currentChapterTitle: this.storyState.currentChapter?.title,
  }

  const { panels, savedPath } = await generateAndSaveVisualPanels(visualInput, {
    maxPanels: 4,
    defaultStyle: "realistic",
    verbose: this.verbose,
  })

  // Logs panel count and save path
}
```

---

## CLI Commands

### Command Line Flags

```bash
# Enable visual panels (default)
/start --visual-panels
/continue --visual-panels

# Disable visual panels
/start --no-visual-panels
```

---

## Panel Generation Workflow

### Updated: LLM-Driven Panel Segmentation (v2.0+)

The panel generation system now uses **LLM-driven intelligent segmentation** instead of mechanical sentence splitting.

```
┌─────────────────────┐
│  Story Segment      │
│  (Complete Text)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────┐
│  generateVisualPanels() │ ← visual-orchestrator.ts
└──────────┬──────────────┘
           │
           ▼
┌──────────────────────────────┐
│  planPanelSegments()         │ ← NEW: LLM analyzes complete story
│  1. Call LLM to analyze      │    and determine optimal panels
│  2. Identify key moments     │
│  3. Detect emotions/chars    │
│  4. Plan panel boundaries    │
└──────────┬───────────────────┘
           │
           ▼
      ┌────┴────┐
      │ LLM OK? │
      └────┬────┘
           │
     ┌─────┴──────┐
     │ YES        │ NO (Fallback)
     ▼            ▼
┌─────────────┐ ┌──────────────────┐
│ LLM Plan    │ │ Sentence-based   │
│ - panelCount│ │ - Split by [.!?] │
│ - segments[]│ │ - Filter >10 chars│
│ - keyMoments│ │ - Extract chars  │
│ - emotions  │ │ - Detect emotions│
└──────┬──────┘ └──────┬───────────┘
       │               │
       └───────┬───────┘
               │
               ▼
┌─────────────────────────────┐
│  For each segment:          │
│  1. Build context object    │
│  2. Call hybrid engine      │
│  3. Generate VisualPanelSpec│
└──────────┬──────────────────┘
           │
           ▼
┌──────────────────────────┐
│  assemblePanelSpec()     │ ← visual-translator.ts
│  - Camera from action    │
│  - Lighting from time    │
│  - Deterministic hashes  │
│  - Priority prompts      │
└──────────┬───────────────┘
           │
           ▼
┌─────────────────────┐
│  saveVisualPanels() │ → JSON file
└─────────────────────┘
```

### Old: Mechanical Sentence Splitting (Deprecated)

**Previous behavior (before v2.0)**:

- Split story by sentence delimiters `[.!? \n]`
- Filter sentences with length > 10 chars
- Each sentence → one panel
- No understanding of narrative flow or key moments

**Problems**:

- Too many panels for complex scenes
- Misses emotional turning points
- No character/emotion detection
- Mechanical division lacks visual direction

---

## Key Design Principles

1. **Configuration-Driven**: All hardcoded values moved to `visual-config.json`
2. **Hybrid Architecture**: LLM for creativity, hardcoded for speed/reliability
3. **Character Consistency**: Deterministic hashing ensures same character appearance across panels
4. **Theme-Aware**: Dynamic strategy layers adapt to story tension and motifs
5. **Graceful Degradation**: Falls back through multiple levels (LLM → hardcoded → scene-only)
6. **LLM-Driven Segmentation** (v2.0+): LLM analyzes complete story to plan optimal panel count and boundaries
7. **Scene Complexity Detection**: Automatically detects action, emotional, dialogue, and transformation scenes
8. **Character & Emotion Extraction**: Identifies character names and emotional states from text

---

## Example Output

Generated panel JSON structure:

```json
{
  "panels": [
    {
      "id": "panel-0-1711036800000",
      "panelIndex": 0,
      "camera": {
        "shot": "medium",
        "angle": "eye-level",
        "movement": "static",
        "depthOfField": "shallow"
      },
      "lighting": "natural",
      "composition": "rule-of-thirds",
      "visualPrompt": "(Lin Mo: detective in trench coat, weary expression), lighting: chiaroscuro, style: noir, cinematic",
      "negativePrompt": "blurry, low quality, distorted, ugly, deformed, watermark",
      "controlNetSignals": {
        "poseReference": "mock://chars/v1_abc123/ref.png",
        "depthReference": null,
        "characterRefUrl": "mock://chars/v1_abc123/ref.png"
      },
      "styleModifiers": ["noir", "cinematic", "high detail"],
      "promptVersion": "v3",
      "hashStrategy": "deterministic"
    }
  ],
  "chapter": 5,
  "generatedAt": "2026-03-21T12:00:00.000Z",
  "panelCount": 4,
  "hasCharacters": true
}
```

---

## Related Files

- **Main Entry**: `src/novel/visual-orchestrator.ts`
- **Prompt Engineering**: `src/novel/visual-prompt-engineer.ts`
- **Translation Layer**: `src/novel/visual-translator.ts`
- **Configuration**: `src/novel/config/config-loader.ts`
- **Types**: `src/novel/types.ts`
- **CLI Command**: `src/cli/cmd/novel.ts`
- **Orchestrator Integration**: `src/novel/orchestrator.ts`
- **Novel Configuration**: `src/novel/config/novel-config.json`

---

## Appendix: Chapter Length Control

### Dynamic Length Mode (Default)

The novel engine now uses **dynamic chapter length** by default, allowing the LLM to determine appropriate length based on:

- **Scene Complexity**: Action scenes and plot twists may require more detail
- **Emotional Depth**: Character development scenes need space for psychological exploration
- **Narrative Importance**: Key plot points deserve expanded treatment
- **Pacing**: Short chapters for tension, longer for immersion

### Configuration Options

In `novel-config.json`, you can customize chapter length:

```json
{
  "chapterLength": {
    "mode": "dynamic",
    "minWords": 800,
    "maxWords": 3000,
    "minChineseChars": 1000,
    "maxChineseChars": 5000,
    "qualityOverQuantity": true,
    "complexityFactors": {
      "actionScenes": 1.5,
      "emotionalScenes": 1.3,
      "dialogueScenes": 0.8,
      "transitionScenes": 0.6
    }
  }
}
```

**Modes**:

- `"dynamic"` - LLM decides based on content (recommended)
- `"fixed"` - Enforces word/character count ranges

**Complexity Factors** (for future use):

- Multipliers applied to base length based on scene type
- Currently informational, can be integrated into LLM prompts

### Previous Fixed Length (Deprecated)

**Old behavior** (before v2.0):

- Fixed: 300-500 words (English) or 500-800 Chinese characters
- Applied uniformly regardless of content
- Limited creative expression and story quality

**Why changed**:

- Quality storytelling requires flexible chapter lengths
- Different scenes have different pacing needs
- LLM can make better creative decisions with guidelines, not rigid rules

---

_Document generated: 2026-03-21_
