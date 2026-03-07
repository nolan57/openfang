# Novel Writing Engine: Technical Specification

## Project Overview

- **Project Name**: Novel Writing Engine CLI
- **Type**: OpenCodeClaw Extension (Skill + CLI Commands)
- **Core Functionality**: Self-evolving narrative system with dynamic pattern extraction and CLI control
- **Target Users**: Writers, game masters, interactive fiction authors

---

## Requirements

### 1. PatternMiner Agent

Create a background agent that analyzes prompts and story context to:

- Extract keywords (themes, objects, concepts)
- Generate dynamic memory patterns
- Synthesize temporary skills for complex narrative structures

### 2. CLI Slash Commands

Implement slash commands for novel control:

- `/start [prompt.md]` - Initialize new story session
- `/continue` - Resume self-evolving loop
- `/inject [file.md]` - Add context without restart
- `/evolve` - Trigger PatternMiner immediately
- `/state [character]` - Display current state
- `/export [format]` - Export story (md/json/pdf)

### 3. Story State Management

Maintain persistent JSON state:

- Character_State: psychology, secrets, clues, health
- World_State: environment, time, events
- Relationship_Map: trust, hostility, power dynamics

### 4. Dynamic Skill Generation

Auto-generate skills when detecting:

- Genre patterns (Time Loop, Non-Linear Story)
- Narrative structures
- Theme-specific rules

---

## Files to Create

### 1. src/cli/cmd/novel.ts

CLI command handler for novel operations

```typescript
// Handles /start, /continue, /inject, /state, /export, /evolve
```

### 2. src/skill/novel-engine.ts

Novel engine core with state management

```typescript
// Manages story state, character tracking, world rules
```

### 3. src/learning/pattern-miner.ts

LLM-powered pattern extraction

```typescript
// Analyzes prompts, extracts keywords, generates patterns
```

### 4. src/skill/novel-patterns/dynamic.ts

Dynamic pattern storage

```typescript
// Merges static and auto-extracted patterns
```

### 5. src/config/novel-config.ts

Novel-specific configuration

```typescript
// Default patterns, genre templates, CLI settings
```

---

## Technical Implementation

### Allowed Paths (for safety)

- src/skill/novel-\*.ts
- src/cli/cmd/novel.ts
- src/learning/pattern-miner.ts
- src/config/novel-config.ts
- src/evolution/novel/

### Dependencies

- Use existing LLM providers (anthropic/openai)
- Reuse existing skill loading system
- Integrate with file watcher for auto-reload

---

## Acceptance Criteria

1. ✅ CLI commands /start, /continue, /inject, /state work correctly
2. ✅ PatternMiner extracts keywords from prompts
3. ✅ Story state persists across sessions
4. ✅ Dynamic skills generated for detected patterns
5. ✅ TypeScript compiles without errors
6. ✅ Integration with existing OpenCodeClaw system
