# OpenCode Novel Engine

AI-driven interactive fiction generation system with dynamic story branching, character psychology deepening, and visual panel generation.

## Core Architecture

```
novel/
├── orchestrator.ts          # Main orchestrator - story generation loop
├── types.ts                 # Type definitions and constants
├── model.ts                 # AI model acquisition
├── state-extractor.ts       # State extractor
├── evolution-rules.ts       # Evolution rules engine
├── character-deepener.ts    # Character psychology deepening
├── relationship-analyzer.ts # Relationship dynamics analysis
├── narrative-skeleton.ts    # Narrative skeleton
├── thematic-analyst.ts      # Thematic analysis
├── pattern-miner.ts         # Pattern mining
├── command-parser.ts        # Slash commands
├── visual-orchestrator.ts   # Visual panel generation
├── visual-prompt-engineer.ts# LLM prompt engineering
└── visual-translator.ts     # Visual translation
```

## Main Functional Modules

### 1. Story Generation (Orchestrator)

`EvolutionOrchestrator` is the core coordinator:

- **Branch Generation**: LLM-driven multi-branch story generation
- **Chaos System**: 1-6 dice determines story direction
- **State Persistence**: Auto-save/load story state

```ts
const orchestrator = new EvolutionOrchestrator({ branchOptions: 3, verbose: true })
await orchestrator.loadState()
const story = await orchestrator.runNovelCycle(prompt, useBranches)
```

### 2. State Extraction (State Extractor)

Extracts structured state changes from story text:

- Character emotions, stress, skills, trauma
- Relationship trust, hostility
- World events, clues

```ts
const extractor = new StateExtractor()
const updates = await extractor.extract(storyText, currentState)
const newState = extractor.applyUpdates(currentState, updates)
```

### 3. Character Deepening (Character Deepener)

Analyzes characters based on psychological frameworks:

- **Big Five Personality**: Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism
- **Attachment Theory**: Secure, Anxious, Avoidant, Disorganized
- **Character Arc**: Denial → Resistance → Exploration → Integration → Mastery

```ts
const deepener = new CharacterDeepener()
const profile = await deepener.deepenCharacter({
  name: "Protagonist",
  status: "active",
  stress: 45,
  traits: ["brave", "stubborn"],
  skills: [...],
  trauma: [...],
})
```

### 4. Relationship Analysis (Relationship Analyzer)

Analyzes dynamics between characters:

- Relationship types: Ally, Rival, Mentor, Lover, Enemy
- Power balance: Dominant, Submissive, Equal, Shifting
- Relationship stages: Formation, Development, Stable, Crisis, Transformation

```ts
const analyzer = new RelationshipAnalyzer()
const result = await analyzer.analyzeAllRelationships(characters)
```

### 5. Narrative Skeleton

Structural planning for long-form stories:

- **Story Lines**: Multiple interweaving plot threads
- **Key Beats**: Major events in each storyline
- **Thematic Motifs**: Recurring imagery and variations

### 6. Thematic Analysis (Thematic Analyst)

Periodic literary analysis:

- Thematic consistency scoring
- Imagery evolution tracking
- Character arc evaluation
- Narrative pacing analysis

## Slash Commands

| Command | Description |
|---------|-------------|
| `/start [file]` | Start new story (optional prompt file) |
| `/continue` | Continue from last chapter |
| `/inject <file>` | Inject context file |
| `/evolve` | Force pattern analysis |
| `/state [target]` | View world state or character state |
| `/export <md\|json>` | Export story |
| `/patterns` | Display discovered patterns |
| `/reset` | Reset story state |
| `/help` | Show help |

## State Definitions

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
  mindModel: { publicSelf, privateSelf, blindSpot }
}
```

### Trauma Tags

```ts
const TRAUMA_TAGS = {
  VISUAL: "PTSD_Visual",
  PHYSICAL_PAIN: "Physical_Pain",
  PSYCHOLOGICAL_FEAR: "Psychological_Fear",
  PSYCHOLOGICAL_BETRAYAL: "Psychological_Betrayal",
  SOCIAL_HUMILIATION: "Social_Humiliation",
  // ...
}
```

### Skill Categories

```ts
const SKILL_CATEGORIES = {
  ANALYSIS: "Mental_Analysis",
  INTERROGATION: "Social_Interrogation",
  COMBAT: "Combat_Physical",
  HACKING: "Technical_Hacking",
  // ...
}
```

## Chaos Table

| Roll | Category | Effect |
|------|----------|--------|
| 1 | Catastrophic Failure | Equipment failure / Ally injured / Key evidence lost |
| 2-3 | Complication | New obstacles / Time limits / Resources depleted |
| 4-5 | Standard Flow | Natural story progression |
| 6 | Unexpected Boon | Hidden items discovered / Ally support / Clues revealed |

## Visual Generation

### Panel Specification

```ts
interface VisualPanelSpec {
  camera: { shot, angle, movement, depthOfField }
  lighting: string
  composition: string
  visualPrompt: string
  negativePrompt: string
  controlNetSignals: { poseReference, depthReference, characterRefUrl }
  styleModifiers: string[]
}
```

### Hybrid Engine Strategy

- **Hardcoded Rules**: Fast response for common scenarios
- **LLM Enhancement**: Handles complex emotions and abstract scenes
- **Confidence Fallback**: Uses hardcoded rules when confidence is low

### Action Keyword Mapping

```json
{
  "fight": ["fight", "battle", "attack", "combat"],
  "chase": ["chase", "run", "pursue", "escape"],
  "conversation": ["talk", "speak", "discuss", "dialogue"],
  "romantic": ["love", "kiss", "embrace", "tender"]
}
```

## Configuration Paths

- **Story State**: `.opencode/novel/state/story_bible.json`
- **Dynamic Patterns**: `.opencode/novel/patterns/dynamic-patterns.json`
- **Skills Directory**: `.opencode/novel/skills/`
- **Narrative Skeleton**: `.opencode/novel/narrative_skeleton.json`
- **Visual Panels**: `.opencode/novel/panels/`
- **Thematic Reflections**: `.opencode/novel/reflections/`

## Development Commands

```bash
# Run tests
bun test src/novel/evolution-rules.test.ts

# Type check
bun typecheck
```

## Key Dependencies

- `ai` - AI SDK for text generation
- `zod` - Schema validation
- Internal deps: `../agent/agent`, `../provider/provider`, `../skill/skill`, `../util/log`

## Design Principles

1. **LLM First**: Complex decisions driven by LLM, hardcoded rules as fallback
2. **Progressive Deepening**: Character psychology revealed gradually as story progresses
3. **Traceable Branches**: All branch history saved, supports time travel
4. **Security First**: File path validation prevents directory traversal attacks