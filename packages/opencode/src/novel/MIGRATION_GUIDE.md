# Hardcoding Improvement Migration Guide

## Overview

This document guides you through migrating hardcoded content in the Novel Engine to the new configurable and dynamic system.

---

## Completed ✅

### 1. Unified Configuration System

**File:** `novel-config.ts`

**Features:**

- Difficulty presets (easy/normal/hard/nightmare)
- Story type weights (action/character/theme/balanced)
- Prompt style presets (concise/balanced/creative)

**Usage Example:**

```typescript
import { novelConfigManager } from "./novel-config"

// Load configuration
await novelConfigManager.load()

// Get difficulty preset
const difficulty = novelConfigManager.getDifficultyPreset()
console.log(difficulty.stressThresholds.critical) // 90 (normal)

// Get story type weights
const weights = novelConfigManager.getStoryTypeWeights()
console.log(weights.tensionLevel) // 0.15 (balanced)

// Update configuration
novelConfigManager.update({
  difficulty: "hard",
  storyType: "action",
})

// Save configuration
await novelConfigManager.save()
```

**Configuration File Format:**

```json
{
  "difficulty": "normal",
  "storyType": "balanced",
  "promptStyle": {
    "verbosity": "balanced",
    "creativity": 0.7,
    "structureStrictness": 0.5,
    "allowDeviation": true
  }
}
```

---

### 2. Dynamic Prompt Builder

**File:** `dynamic-prompt.ts`

**Features:**

- Template-based prompt construction
- Automatic tone instruction injection
- Automatic style instruction injection
- Custom variable support

**Usage Example:**

```typescript
import { createPromptBuilder } from "./dynamic-prompt"

// Create prompt builder
const builder = createPromptBuilder("stateEvaluation")

// Set story tone
builder.withTone({
  genre: "dark fantasy",
  mood: "tense",
  pacing: "fast",
  contentRating: "mature",
  themes: ["sacrifice", "redemption"],
  style: "descriptive",
})

// Set variables and build
const prompt = builder.withVariables({ STORY_SEGMENT: storyText }).build()
```

**Predefined Templates:**

- `stateEvaluation` - State change evaluation
- `chaosEvent` - Chaos event generation
- `characterAnalysis` - Character psychology analysis
- `branchGeneration` - Branch generation

---

## Pending Migration 🔲

### 1. Update evolution-rules.ts

**Current Status:** Using hardcoded prompt template

**Migration Steps:**

```typescript
// Old code
const prompt = STATE_CHANGE_EVALUATION_PROMPT.replace("{{STORY_SEGMENT}}", storyText)

// New code
import { createPromptBuilder } from "./dynamic-prompt"
import { novelConfigManager } from "./novel-config"

const config = novelConfigManager.getConfig()
const builder = createPromptBuilder("stateEvaluation", config.promptStyle)

if (storyTone) {
  builder.withTone(storyTone)
}

const prompt = builder.withVariables({ STORY_SEGMENT: storyText }).build()
```

**File Location:** `evolution-rules.ts:117-130`

---

### 2. Update branch-manager.ts Scoring Weights

**Current Status:** Hardcoded weights

```typescript
// Old code
const weights = {
  narrativeQuality: 0.25,
  tensionLevel: 0.15,
  characterDevelopment: 0.2,
  plotProgression: 0.15,
  characterGrowth: 0.1,
  riskReward: 0.05,
  thematicRelevance: 0.1,
}
```

**Migration Steps:**

```typescript
// New code
import { novelConfigManager } from "./novel-config"

const weights = novelConfigManager.getStoryTypeWeights()

// Weights now automatically adjust based on story type
// action: tensionLevel = 0.30
// character: characterDevelopment = 0.35
// theme: thematicRelevance = 0.30
```

**File Location:** `branch-manager.ts:82-95`

---

### 3. Update Threshold Constants

**Current Status:** Hardcoded thresholds

```typescript
// Old code
private static readonly STRESS_THRESHOLD_CRITICAL = 90
private static readonly STRESS_THRESHOLD_HIGH = 70
```

**Migration Steps:**

```typescript
// New code
import { novelConfigManager } from "./novel-config"

const thresholds = novelConfigManager.getDifficultyPreset().stressThresholds

const STRESS_THRESHOLD_CRITICAL = thresholds.critical // 90 (normal) or 80 (hard)
const STRESS_THRESHOLD_HIGH = thresholds.high // 70 (normal) or 60 (hard)
```

**File Location:** `evolution-rules.ts:85-86`

---

### 4. Update character-deepener.ts

**Current Status:** Static prompts

**Migration Steps:**

```typescript
// New code
import { createPromptBuilder } from "./dynamic-prompt"
import { novelConfigManager } from "./novel-config"

const config = novelConfigManager.getConfig()
const builder = createPromptBuilder("characterAnalysis", config.promptStyle)

if (storyTone) {
  builder.withTone(storyTone)
}

const prompt = builder.withVariables({ CHARACTER_STATE: characterStateJson }).build()
```

**File Location:** `character-deepener.ts:112-150`

---

## Configuration Examples

### Action Story Configuration

```json
{
  "difficulty": "hard",
  "storyType": "action",
  "promptStyle": {
    "verbosity": "concise",
    "creativity": 0.6,
    "structureStrictness": 0.4,
    "allowDeviation": true
  }
}
```

**Effects:**

- Lower stress thresholds (critical: 80, high: 60)
- Higher tension weight (0.30 vs 0.15)
- Fewer branches (10 vs 20)
- More frequent trauma (1.5x)
- Concise and direct prompts

---

### Character-Driven Story Configuration

```json
{
  "difficulty": "normal",
  "storyType": "character",
  "promptStyle": {
    "verbosity": "detailed",
    "creativity": 0.8,
    "structureStrictness": 0.3,
    "allowDeviation": true
  }
}
```

**Effects:**

- Highest character development weight (0.35)
- Detailed prompts
- High creativity
- Fewer structure restrictions

---

### Theme-Driven Story Configuration

```json
{
  "difficulty": "easy",
  "storyType": "theme",
  "promptStyle": {
    "verbosity": "balanced",
    "creativity": 0.7,
    "structureStrictness": 0.5,
    "allowDeviation": false
  }
}
```

**Effects:**

- Highest thematic relevance weight (0.30)
- Higher stress thresholds (critical: 100)
- More branches (30)
- More frequent skill awards (1.5x)

---

## Best Practices

### 1. Use Presets Instead of Custom Configuration

```typescript
// ✅ Recommended: Use presets
novelConfigManager.update({
  difficulty: "hard",
  storyType: "action",
})

// ⚠️ Avoid: Manually configuring all weights
novelConfigManager.update({
  customWeights: {
    narrativeQuality: 0.2,
    tensionLevel: 0.3,
    // ... manually configuring all 7 weights
  },
})
```

### 2. Load Configuration Before Use

```typescript
// ✅ Recommended
await novelConfigManager.load()
const config = novelConfigManager.getConfig()

// ⚠️ Avoid: Using before loading
const config = novelConfigManager.getConfig() // May be default value
```

### 3. Save User Preferences

```typescript
// Save after first-time setup
novelConfigManager.update({
  difficulty: "normal",
  storyType: "balanced",
})
await novelConfigManager.save()

// Subsequent sessions auto-load
await novelConfigManager.load()
```

### 4. Separate Story Tone from Configuration

```typescript
// Configuration: Persistent user preferences
novelConfigManager.update({
  storyType: "action", // Type
  difficulty: "normal", // Difficulty
})

// Tone: Story-specific settings
const storyTone = {
  genre: "cyberpunk", // Specific genre
  mood: "dark", // Mood
  pacing: "fast", // Pacing
  // ...
}

// Usage
builder.withTone(storyTone)
```

---

## Migration Checklist

- [ ] Install new modules (novel-config.ts, dynamic-prompt.ts)
- [ ] Update evolution-rules.ts to use dynamic prompts
- [ ] Update branch-manager.ts to use configured weights
- [ ] Update character-deepener.ts to use dynamic prompts
- [ ] Update orchestrator.ts to load configuration
- [ ] Create default configuration file
- [ ] Test different configuration combinations
- [ ] Update documentation

---

## Troubleshooting

### Configuration Load Failed

**Problem:** `novel_config_load_failed`

**Solution:**

```typescript
try {
  await novelConfigManager.load()
} catch (error) {
  // Automatically use default configuration
  console.log("Using default configuration")
}
```

### Unknown Prompt Template

**Problem:** `Unknown template: xxx`

**Solution:** Check if template ID is defined in `PROMPT_TEMPLATES`

### Weights Don't Sum to 1

**Problem:** Branch scoring anomalies

**Solution:** Validate custom weights:

```typescript
const weights = novelConfigManager.getStoryTypeWeights()
const sum = Object.values(weights).reduce((a, b) => a + b, 0)
console.assert(Math.abs(sum - 1.0) < 0.001, "Weights must sum to 1")
```

---

## Performance Considerations

### Configuration Loading

- First load: ~10ms (file read)
- Subsequent access: ~0ms (memory cached)

### Prompt Construction

- Simple substitution: ~1ms
- Tone instruction injection: ~2ms
- Overall impact: Negligible

### Recommendations

- ✅ Load configuration at application startup
- ✅ Reuse configuration objects instead of reloading
- ✅ Construct prompts before LLM calls

---

## Next Steps

### Phase 1 (Completed)

- ✅ Unified configuration system
- ✅ Dynamic prompt builder
- ✅ Predefined templates

### Phase 2 (In Progress)

- 🔲 Update all modules to use new system
- 🔲 Add configuration UI
- 🔲 Add configuration validation

### Phase 3 (Planned)

- 🔲 Runtime configuration hot updates
- 🔲 Configuration import/export
- 🔲 Configuration sharing features

---

_Last updated: 2026-03-15_
_Novel Engine Hardcoding Migration Guide_
