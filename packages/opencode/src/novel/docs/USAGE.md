# Novel Engine Usage Guide

## Quick Start

### 1. Start a New Story (with Self-Evolution Loops)

```bash
# Basic usage - 1 loop
opencode novel start /Users/lpcw/Documents/opencode/novels/novel1.md

# 3 self-evolution loops
opencode novel start /Users/lpcw/Documents/opencode/novels/novel1.md --loops 3

# Or use shorthand
opencode novel start /Users/lpcw/Documents/opencode/novels/novel1.md -l 3
```

### 2. Continue Story

```bash
# Continue from last saved state
opencode novel continue
```

### 3. View Story State

```bash
# View world state
opencode novel state world

# View specific character state
opencode novel state <character-name>
```

### 4. Manually Trigger Evolution

```bash
# Analyze current story and extract patterns
opencode novel evolve

# Analyze specific file
opencode novel evolve --file /path/to/file.md
```

### 5. Other Commands

```bash
# View discovered patterns
opencode novel patterns

# Export story
opencode novel export md        # Markdown format
opencode novel export json      # JSON format
opencode novel export pdf       # PDF format

# Reset story
opencode novel reset

# Inject additional context
opencode novel inject /path/to/context.md
```

---

## Configuration Files

### Novel Engine Configuration

**Location:** `packages/opencode/.opencode/novel/config/novel-config.json`

```json
{
  "difficulty": "normal",
  "storyType": "theme",
  "promptStyle": {
    "verbosity": "detailed",
    "creativity": 0.85,
    "structureStrictness": 0.4,
    "allowDeviation": true
  }
}
```

### Difficulty Presets

| Difficulty    | Stress Thresholds       | Branches | Trauma Frequency | Skill Awards |
| ------------- | ----------------------- | -------- | ---------------- | ------------ |
| **easy**      | critical: 100, high: 85 | 30       | 0.5x             | 1.5x         |
| **normal**    | critical: 90, high: 70  | 20       | 1.0x             | 1.0x         |
| **hard**      | critical: 80, high: 60  | 10       | 1.5x             | 0.7x         |
| **nightmare** | critical: 70, high: 50  | 5        | 2.0x             | 0.5x         |

### Story Type Weights

| Type          | narrativeQuality | tensionLevel | characterDevelopment | plotProgression | thematicRelevance |
| ------------- | ---------------- | ------------ | -------------------- | --------------- | ----------------- |
| **action**    | 0.20             | 0.30         | 0.15                 | 0.20            | 0.05              |
| **character** | 0.20             | 0.10         | 0.35                 | 0.10            | 0.05              |
| **theme**     | 0.20             | 0.10         | 0.15                 | 0.10            | 0.30              |
| **balanced**  | 0.25             | 0.15         | 0.20                 | 0.15            | 0.10              |

---

## Recommended Testing Workflow

### Complete Test with novel1.md

1. **Configure Novel Engine** (Completed)

   ```bash
   # Configuration file already created
   cat packages/opencode/.opencode/novel/config/novel-config.json
   ```

2. **Start Story with 3 Self-Evolution Loops**

   ```bash
   cd /Users/lpcw/Documents/opencode/packages/opencode
   bun run --conditions=bun src/index.ts novel start /Users/lpcw/Documents/opencode/novels/novel1.md --loops 3
   ```

3. **View Story State**

   ```bash
   bun run --conditions=bun src/index.ts novel state world
   ```

4. **View Discovered Patterns**

   ```bash
   bun run --conditions=bun src/index.ts novel patterns
   ```

5. **Continue Story**

   ```bash
   bun run --conditions=bun src/index.ts novel continue
   ```

---

## novel1.md Prompt Analysis

```markdown
[THEME: The Echoes of Betrayal Across Time — How a single act of broken trust in the past reverberates through generations, shaping destinies in the present.]
[TONE: Haunting, Elegant, Heartrending, Multi-generational, Interwoven]
[GENRE: A sprawling, multi-era narrative in the spirit of "Dream of the Red Chamber", weaving together classical Chinese ghost lore, historical drama, and contemporary mystery.]
[FOCUS: Begin with loosely connected storylines across different time periods (e.g., Ming Dynasty, Late Qing, Present Day). Allow their thematic and karmic connections to gradually deepen, culminating in a powerful convergence that reveals the original sin and its enduring legacy.]
```

**Characteristics:**

- Multi-era narrative (Ming Dynasty, Late Qing, Present Day)
- Theme: Echoes of betrayal across time
- Style: Dream of the Red Chamber narrative + Chinese ghost lore + historical drama + contemporary mystery
- Tone: Haunting, elegant, heartrending, multi-generational, interwoven

**Recommended Configuration:**

```json
{
  "difficulty": "normal",
  "storyType": "theme",
  "promptStyle": {
    "verbosity": "detailed",
    "creativity": 0.85,
    "structureStrictness": 0.4,
    "allowDeviation": true
  }
}
```

---

## FAQ

### Q: How to increase self-evolution loops?

**A:** Use `--loops` or `-l` flag:

```bash
opencode novel start prompt.md --loops 5
```

### Q: How to view current configuration?

**A:** View configuration file:

```bash
cat packages/opencode/.opencode/novel/config/novel-config.json
```

### Q: How to change difficulty?

**A:** Edit the `difficulty` field in configuration:

```json
{
  "difficulty": "hard" // easy, normal, hard, nightmare
}
```

### Q: How to change story type?

**A:** Edit the `storyType` field in configuration:

```json
{
  "storyType": "character" // action, character, theme, balanced
}
```

---

## Log Levels

```bash
# Show all logs
opencode novel start prompt.md --log-level DEBUG

# Show errors only
opencode novel start prompt.md --log-level ERROR
```

---

_Last updated: 2026-03-15_
_Novel Engine Usage Guide_
