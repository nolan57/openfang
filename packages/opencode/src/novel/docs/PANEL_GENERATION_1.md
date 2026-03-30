# Novel Module - Panel Generation Methods

This document provides a comprehensive overview of the panel generation system in the novel module.

## Overview

The novel module's panel generation system creates visual panel specifications from story segments. It uses a hybrid architecture combining LLM-based creativity with hardcoded rules for speed and reliability.

## Core Files

| File | Purpose |
|------|---------|
| `visual-orchestrator.ts` | Main entry point, orchestration logic |
| `visual-prompt-engineer.ts` | Hybrid prompt engine (LLM + rules) |
| `visual-translator.ts` | Visual translation layer |
| `config/config-loader.ts` | Configuration system |
| `types.ts` | Type definitions |

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
export async function saveVisualPanels(
  panels: VisualPanelSpec[], 
  chapterCount: number
): Promise<string | null>
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

#### `translateStoryToPanels()`
```typescript
export function translateStoryToPanels(
  storyText: string,
  characterStates: CharacterState[],
  options?: {...}
): VisualPanelSpec[]
```

**Purpose**: Convert entire story segment to multiple panels.

---

## Configuration System

### From `config/config-loader.ts`

**Config Files**:
- `visual-config.json` - Main configuration (18KB)
- `visual-config.schema.json` - Zod validation schema
- `novel-config.json` - Novel-specific settings

### Strategy Layers (v3)

```typescript
export function resolveVisualSpec(context: VisualContext): ResolvedVisualSpec
```

**Dynamic Resolution Flow**:
1. **Base Layer**: Default emotion/action mappings
2. **Override Layer**: Context-aware overrides (tension level, active motifs)
3. **Thematic Voting**: Multiple motifs vote with weighted influence
4. **Conflict Resolution**: Removes contradictory terms (e.g., "warm" vs "cold")

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
  shot: string          // e.g., "medium", "close-up", "wide"
  angle: string         // e.g., "eye-level", "low-angle", "bird's-eye"
  movement: string      // e.g., "static", "pan", "dolly"
  depthOfField: string  // e.g., "shallow", "deep"
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

```
┌─────────────────────┐
│  Story Segment      │
│  + Character State  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────┐
│  generateVisualPanels() │ ← visual-orchestrator.ts
└──────────┬──────────────┘
           │
           ▼
┌──────────────────────────────┐
│  For each segment:           │
│  1. Extract character state  │
│  2. Build context object     │
│  3. Call hybrid engine       │
└──────────┬───────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│  buildPanelSpecWithHybridEngine()│ ← visual-prompt-engineer.ts
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Decision: Use LLM?         │
│  - Complex emotion/action?  │
│  - Long description?        │
│  - Need continuity?         │
└──────┬──────────────┬───────┘
       │ YES          │ NO
       ▼              ▼
┌─────────────┐ ┌──────────────┐
│ callLLM()   │ │ Hardcoded    │
│ + Fallback  │ │ Rules        │
└──────┬──────┘ └──────┬───────┘
       │               │
       └───────┬───────┘
               │
               ▼
┌──────────────────────────┐
│  Assemble VisualPanelSpec│ ← visual-translator.ts
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

---

## Key Design Principles

1. **Configuration-Driven**: All hardcoded values moved to `visual-config.json`
2. **Hybrid Architecture**: LLM for creativity, hardcoded for speed/reliability
3. **Character Consistency**: Deterministic hashing ensures same character appearance across panels
4. **Theme-Aware**: Dynamic strategy layers adapt to story tension and motifs
5. **Graceful Degradation**: Falls back through multiple levels (LLM → hardcoded → scene-only)

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

---

*Document generated: 2026-03-21*
