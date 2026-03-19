# Daily Commit Report - 2026-03-19

This report summarizes all changes made on March 19, 2026.

---

## Summary Statistics

| Metric         | Count      |
| -------------- | ---------- |
| Total Commits  | 2          |
| Files Modified | 6          |
| Files Created  | 4          |
| Files Deleted  | 0          |
| Lines Added    | ~750       |
| Lines Removed  | ~40        |
| Net Change     | +710 lines |

---

## Commits Overview

| #   | Commit      | Description                                                         |
| --- | ----------- | ------------------------------------------------------------------- |
| 1   | `feat-novel-config` | Externalize hardcoded constants for novel engine configurability |
| 2   | `feat-layered-config` | Implement layered config loading with prompt embedding and LLM inference |

---

## Detailed Commit Breakdown

### Commit 1: Externalized Hardcoded Constants for Novel Engine Configurability

This commit implements external configurability for previously hardcoded constants in the novel engine, enabling story-specific customization of trauma tags, skill categories, goal types, emotion types, character status, and thematic reflection intervals.

---

#### 1. Novel Config Schema Extension (`novel-config.ts` - +85 lines)

**Added new schemas for custom type definitions:**

```typescript
export const CustomTraumaTagsSchema = z.record(z.string(), z.string())
export const CustomSkillCategoriesSchema = z.record(z.string(), z.string())
export const CustomGoalTypesSchema = z.record(z.string(), z.string())
export const CustomEmotionTypesSchema = z.record(z.string(), z.string())
export const CustomCharacterStatusSchema = z.record(z.string(), z.string())
```

**Added getter methods in NovelConfigManager:**

- `getThematicReflectionInterval()` - Returns interval (default: 5)
- `getCustomTraumaTags()` - Returns custom trauma tags
- `getCustomSkillCategories()` - Returns custom skill categories
- `getCustomGoalTypes()` - Returns custom goal types
- `getCustomEmotionTypes()` - Returns custom emotion types
- `getCustomCharacterStatus()` - Returns custom character status

---

#### 2. Types Refactoring (`types.ts` - +120 lines)

**Renamed constants to DEFAULT_* prefix:**

```typescript
export const DEFAULT_TRAUMA_TAGS = { ... } as const
export const DEFAULT_SKILL_CATEGORIES = { ... } as const
export const DEFAULT_CHARACTER_STATUS = { ... } as const

// Backward compatibility aliases
export const TRAUMA_TAGS = DEFAULT_TRAUMA_TAGS
```

**Added runtime configuration and getter functions:**

```typescript
export function initializeCustomTypes(config: CustomTypeConfig): void
export function getTraumaTags(): Record<string, string>
export function getSkillCategories(): Record<string, string>
export function getGoalTypes(): Record<string, string>
export function getEmotionTypes(): Record<string, string>
export function getCharacterStatus(): Record<string, string>
```

---

#### 3. Core Module Updates

**Orchestrator (`orchestrator.ts`):**
- Added `initializeCustomTypes` import
- Integrated config loading in `initializeAdvancedModules()`
- Replaced hardcoded `THEMATIC_REFLECTION_INTERVAL` with config value

**Evolution Rules (`evolution-rules.ts`):**
- Updated imports to use getter functions
- Modified `normalizeSkillCategory()` and `calculateTraumaSeverityFromTags()`

**State Extractor (`state-extractor.ts`):**
- Updated imports to use getter functions
- Modified `selectTraumaTags()` method

---

### Commit 2: Layered Config Loading with Prompt Embedding and LLM Inference

This commit implements a sophisticated layered configuration system that allows users to provide configuration through multiple methods with a clear priority order.

---

#### Config Loading Priority

```
1. --config=<path>    (Explicit CLI parameter - highest priority)
2. Default file       (~/.opencode/novel/config/novel-config.json)
3. Prompt embedded    (YAML front matter in story prompt)
4. LLM inference      (AI-generated config based on prompt analysis)
5. Embedded defaults  (Hardcoded values in code - lowest priority)
```

---

#### 1. Novel Config Manager Enhancements (`novel-config.ts` - +250 lines)

**New methods in NovelConfigManager:**

```typescript
// Load from explicit path
async loadFromPath(configPath: string): Promise<NovelEngineConfig>

// Merge overlay config on top of current
mergeConfig(overlay: Partial<NovelEngineConfig>): NovelEngineConfig

// Get config source for debugging
getConfigSource(): string

// Get current config
getConfig(): NovelEngineConfig
```

**New standalone functions:**

```typescript
// Extract config from YAML front matter
export function extractConfigFromPrompt(content: string): {
  config: Partial<NovelEngineConfig> | null
  promptContent: string
  metadata: Record<string, any>
}

// Infer config from prompt using LLM
export async function inferConfigFromPrompt(
  promptContent: string
): Promise<Partial<NovelEngineConfig>>

// Layered config loading entry point
export async function loadLayeredConfig(options: {
  explicitConfigPath?: string
  promptContent?: string
  enableInference?: boolean
}): Promise<NovelConfigManager>
```

**YAML Front Matter Parsing:**

```typescript
// Simple YAML-like parsing for front matter
function parseYamlValue(value: string): any {
  // Handles: boolean, number, quoted string, plain string
}

function validatePartialConfig(
  partial: Record<string, any>
): Partial<NovelEngineConfig> | null
```

---

#### 2. Command Parser Updates (`command-parser.ts` - +30 lines)

**Enhanced `/start` command:**

```
/start [file] [--config=<path>] [--infer]
```

| Flag | Description |
| ---- | ----------- |
| `[file]` | Optional story prompt file path |
| `--config=<path>` | Explicit config file path |
| `--infer` | Enable LLM config inference |

**Implementation:**

```typescript
// Parse arguments
for (const arg of args) {
  if (arg.startsWith("--config=")) {
    configPath = arg.slice("--config=".length)
  } else if (arg === "--infer") {
    enableInference = true
  } else if (!arg.startsWith("--")) {
    filePath = arg
  }
}

// Use layered config loading
const configManager = await loadLayeredConfig({
  explicitConfigPath: configPath ? resolveSafePath(cwd, configPath) : undefined,
  promptContent: filePath ? promptContent : undefined,
  enableInference,
})

// Pass config to orchestrator
const orchestrator = new EvolutionOrchestrator({ configManager })
```

---

#### 3. Orchestrator Updates (`orchestrator.ts` - +10 lines)

**Added configManager support:**

```typescript
export interface OrchestratorConfig {
  branchOptions?: number
  verbose?: boolean
  configManager?: NovelConfigManager  // NEW
}

export class EvolutionOrchestrator {
  private configManager: NovelConfigManager  // NEW

  constructor(config: OrchestratorConfig = {}) {
    this.configManager = config.configManager || novelConfigManager
  }

  private async initializeAdvancedModules(): Promise<void> {
    // Use instance configManager instead of singleton
    if (!this.configManager.getConfigSource || 
        this.configManager.getConfigSource() === "default") {
      await this.configManager.load()
    }
    initializeCustomTypes({
      customTraumaTags: this.configManager.getCustomTraumaTags(),
      // ... other config fields
    })
  }
}
```

---

#### 4. Story Prompt Template Update (`story_prompt_template.md` - +60 lines)

**Added YAML front matter documentation:**

```yaml
---
title: The Devotion of Suspect X
author: Your Name
config:
  difficulty: normal
  storyType: character
  thematicReflectionInterval: 3
  promptStyle:
    verbosity: detailed
    creativity: 0.5
  customTraumaTags:
    GUILT: Psychological_Guilt
  customEmotionTypes:
    DEVOTION: Devotion
---

[Story content starts here...]
```

**Config fields table:**

| Field | Type | Description |
|-------|------|-------------|
| `difficulty` | string | easy, normal, hard, nightmare |
| `storyType` | string | action, character, theme, balanced, custom |
| `thematicReflectionInterval` | number | Theme analysis frequency (1-20) |
| `promptStyle.verbosity` | string | concise, balanced, detailed |
| `promptStyle.creativity` | number | 0-1, LLM creativity level |
| `customTraumaTags` | object | Story-specific trauma types |
| `customSkillCategories` | object | Custom skill categories |
| `customGoalTypes` | object | Custom goal types |
| `customEmotionTypes` | object | Custom emotion types |
| `customCharacterStatus` | object | Custom character statuses |

---

#### 5. Suspect X Example Update (`novel2.md` - +60 lines)

**Added complete YAML front matter:**

```yaml
---
title: œ”“…»ÀXµƒœ◊…Ì (The Devotion of Suspect X)
author: Higashino Keigo
config:
  difficulty: normal
  storyType: character
  thematicReflectionInterval: 3
  customTraumaTags:
    GUILT: Psychological_Guilt
    SACRIFICE: Psychological_Sacrifice
    ISOLATION_SELF: Psychological_Self_Isolation
    # ... more tags
  customSkillCategories:
    MATHEMATICAL_GENIUS: Mental_Mathematical_Genius
    DEDUCTION: Mental_Deduction
    # ... more skills
  customEmotionTypes:
    DEVOTION: Devotion
    NUMBNESS: Emotional Numbness
    # ... more emotions
---
```

---

#### 6. Config Template Update (`config/novel-config-template.json`)

**Added priority comment:**

```json
{
  "$comment": "Config Loading Priority: 1) --config flag, 2) default file, 3) prompt embedded, 4) LLM inference, 5) embedded defaults"
}
```

---

## Usage Examples

### CLI Commands

```bash
# Use default config
/start my-story.md

# Specify config file
/start my-story.md --config=config/novel2.json

# Enable LLM config inference
/start my-story.md --infer

# Combine options
/start my-story.md --config=my-config.json --infer
```

### YAML Front Matter

```yaml
---
title: My Story
config:
  difficulty: hard
  storyType: action
  thematicReflectionInterval: 7
---

[Story content...]
```

---

## Files Modified

| File | Lines Added | Lines Removed |
| ---- | ----------- | ------------- |
| `novel-config.ts` | +335 | 0 |
| `types.ts` | +120 | -10 |
| `orchestrator.ts` | +25 | -5 |
| `evolution-rules.ts` | +10 | -5 |
| `state-extractor.ts` | +10 | -5 |
| `command-parser.ts` | +30 | -10 |
| `story_prompt_template.md` | +60 | 0 |
| `novel2.md` | +60 | 0 |
| `config/novel-config-template.json` | +1 | -1 |

## Files Created

| File | Lines | Description |
| ---- | ----- | ----------- |
| `story_prompt_template.md` | +350 | Story prompt template |
| `config/novel-config-template.json` | +65 | Config template |
| `novel2.md` | +280 | Suspect X story prompt |
| `config/novel2.json` | +85 | Suspect X config |
