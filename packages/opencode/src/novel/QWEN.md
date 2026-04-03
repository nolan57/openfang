# Novel Engine - Context

## Overview

AI-driven interactive fiction generation system with dynamic story branching, character psychology deepening, relationship analysis, and visual panel generation. Part of the OpenCode novel engine for creating multi-chapter interactive stories.

### Architecture Pattern

Follows an **Orchestrator Pattern** with LLM-driven decision making. `EvolutionOrchestrator` coordinates all subsystems:

```
CLI Command → EvolutionOrchestrator → Chaos System → LLM Story Generation
  → State Extraction → Character/Relationship Analysis → Visual Panels → Save State
```

### Key Features

- **Multi-branch story generation** with LLM evaluation and selection
- **Chaos system** (dual dice roll) determines narrative direction
- **Character psychology** using Big Five, Attachment Theory, Character Arc frameworks
- **Relationship dynamics** with trust, hostility, power balance tracking
- **Visual panel generation** for image generation (camera specs, lighting, prompts)
- **Knowledge graph** for story world memory
- **Pattern mining** for auto-discovered narrative patterns
- **Thematic analysis** every N turns for literary consistency
- **Self-evolution loops** for continuous story improvement

## Core Modules

| Module | Purpose |
|--------|---------|
| `orchestrator.ts` | Main coordinator - story generation cycle, branch management |
| `state-extractor.ts` | LLM-based extraction of state changes from story text |
| `evolution-rules.ts` | Chaos system, skill/trauma awards, stress limits |
| `character-deepener.ts` | Psychological profiling (Big Five, Attachment Theory) |
| `relationship-analyzer.ts` | Character dynamics, factions, narrative hooks |
| `branch-manager.ts` | Multi-branch story management with pruning |
| `visual-orchestrator.ts` | Visual panel generation for image prompts |
| `story-knowledge-graph.ts` | Graph database for story entities and relationships |
| `story-world-memory.ts` | Hierarchical memory system for story state |
| `pattern-miner.ts` | Discovers and tracks narrative patterns |
| `thematic-analyst.ts` | Periodic literary analysis and reflection |
| `narrative-skeleton.ts` | Long-form story structure planning |
| `novel-config.ts` | Configuration management with difficulty/story type presets |
| `llm-wrapper.ts` | Unified LLM calling interface with retry and tracing |
| `model.ts` | AI model provider acquisition |
| `types.ts` | Type definitions and constants (trauma tags, skills, etc.) |
| `command-parser.ts` | Slash command handling for CLI |

### Advanced Modules

| Module | Purpose |
|--------|---------|
| `character-lifecycle.ts` | Character aging, death, transformation over time |
| `end-game-detection.ts` | Detects story completion conditions |
| `faction-detector.ts` | Detects character factions and groups |
| `motif-tracker.ts` | Tracks recurring imagery and motifs |
| `relationship-inertia.ts` | Plot hooks and relationship momentum |
| `multi-thread-narrative.ts` | Multi-threaded story generation |
| `multiway-relationships.ts` | Complex multi-character relationship dynamics |
| `continuity-analyzer.ts` | Temporal and spatial continuity checking |
| `procedural-world.ts` | Procedural world generation |
| `novel-learning-bridge.ts` | Integration with OpenCode learning system |
| `observability.ts` | Metrics and health monitoring |
| `dynamic-prompt.ts` | Dynamic prompt building with style presets |
| `validation.ts` | Retry logic and input validation |

## Configuration

### Config Files

- **Engine config**: `config/novel-config.json` (source) → `.opencode/novel/config/novel-config.json` (runtime)
- **Story state**: `.opencode/novel/state/story_bible.json`
- **Patterns**: `.opencode/novel/patterns/dynamic-patterns.json`
- **Narrative skeleton**: `.opencode/novel/narrative_skeleton.json`
- **Visual panels**: `.opencode/novel/panels/`
- **Databases**: `.opencode/novel/data/story-memory.db`, `story-graph.db`, `branches.db`

### Difficulty Presets

| Difficulty | Stress Critical | Stress High | Max Branches | Trauma Freq | Skill Freq |
|------------|----------------|-------------|--------------|-------------|------------|
| easy | 100 | 85 | 30 | 0.5x | 1.5x |
| normal | 90 | 70 | 20 | 1.0x | 1.0x |
| hard | 80 | 60 | 10 | 1.5x | 0.7x |
| nightmare | 70 | 50 | 5 | 2.0x | 0.5x |

### Story Types

| Type | Focus | Primary Weight |
|------|-------|---------------|
| action | Plot/tension | tensionLevel (0.30) |
| character | Character growth | characterDevelopment (0.35) |
| theme | Thematic depth | thematicRelevance (0.30) |
| balanced | Even spread | narrativeQuality (0.25) |

## State Model

### Character State

```ts
interface CharacterState {
  status: "active" | "injured" | "stressed" | "unconscious" | "captured" | "deceased"
  stress: number  // 0-100
  emotions: { valence: number, arousal: number, dominant: string }
  traits: string[]
  trauma: TraumaEntry[]
  skills: SkillEntry[]
  secrets: string[]
  clues: string[]
  goals: Goal[]
  mindModel: { publicSelf, privateSelf, blindSpot }  // Theory of Mind
}
```

### Key Constants

- **Trauma tags**: `PTSD_Visual`, `Physical_Pain`, `Psychological_Fear`, `Psychological_Betrayal`, etc.
- **Skill categories**: `Mental_Analysis`, `Social_Interrogation`, `Combat_Physical`, `Technical_Hacking`, etc.
- **Attachment styles**: `secure`, `anxious`, `avoidant`, `disorganized`
- **Goal types**: `survival`, `investigation`, `revenge`, `protection`, `escape`, etc.

## Data Flow

1. **Command parsing** → CLI routes to orchestrator
2. **State loading** → Read `story_bible.json`
3. **Chaos system** → Roll 2d6 for impact + magnitude
4. **Story generation** → LLM generates 300-500 Chinese characters
5. **Branch generation** (optional) → Generate multiple paths, LLM selects best
6. **State extraction** → LLM analyzes text for character/relationship/world changes
7. **Validation** → Audit flags, corrections for impossible changes
8. **Analysis** → Character deepening, relationship dynamics, pattern mining
9. **Visual panels** → Generate camera specs, lighting, prompts for image generation
10. **Persistence** → Save all state to `.opencode/novel/`

## Development

```bash
# Run tests
bun test src/novel/evolution-rules.test.ts
bun test src/novel/phase5.test.ts
bun test src/novel/performance.test.ts
bun test src/novel/visual-orchestrator.test.ts
bun test src/novel/continuity-analyzer.test.ts
bun test src/novel/novel-learning-bridge.test.ts

# Type check
bun typecheck
```

## Key Dependencies

- `ai` - AI SDK for text generation (`generateText`)
- `zod` - Schema validation
- Internal: `../agent/agent`, `../provider/provider`, `../skill/skill`, `../util/log`, `../project/instance`

## Design Principles

1. **LLM First**: Complex decisions driven by LLM, hardcoded rules as fallback
2. **Progressive Deepening**: Character psychology revealed gradually
3. **Traceable Branches**: All branch history saved, supports time travel
4. **Security First**: File path validation prevents directory traversal
5. **Configurable**: Difficulty, story type, prompt styles, custom type tags
6. **Layered Config**: Priority: explicit file → default file → embedded in prompt → LLM inference → defaults
