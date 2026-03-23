# AI Self-Learning System

Enable opencode to periodically learn new knowledge from the web and improve itself.

## Features

- **Multi-Source Collection**: Gather content from web search, arXiv papers, GitHub
- **Smart Analysis**: Evaluate content value, extract tags, generate insights
- **Note Generation**: Create Markdown learning notes
- **Code Suggestions**: Generate improvement suggestions based on learned content
- **Skill Installation**: Automatically install relevant skills
- **Flexible Scheduling**: Cron-based, idle-triggered, or manual execution

## Usage

### Via Tool

```bash
/learn
/learn topics:["AI", "machine learning"]
/learn sources:["search", "github"] topics:["typescript"]
```

### Via Code

```typescript
import { runLearning } from "./learning/command"

const result = await runLearning({
  topics: ["AI agent systems"],
  sources: ["search", "github"],
  max_items_per_run: 5,
})

console.log(result)
// { success: true, collected: 5, notes: 5, installs: 0, suggestions: 2 }
```

## Configuration

Add to `opencode.json`:

```json
{
  "learning": {
    "enabled": true,
    "schedule": {
      "cron": "0 10 * * 1,3,5",
      "idle_check": true,
      "idle_threshold_minutes": 30
    },
    "sources": ["search", "arxiv", "github"],
    "topics": ["AI agent systems", "code generation"],
    "max_items_per_run": 10,
    "note_output_dir": "docs/learning/notes"
  }
}
```

## Output

Notes are saved to: `~/docs/learning/notes/<run-id>/`

```
docs/learning/notes/<run-id>/
├── index.md
├── learning_note_1.md
├── learning_note_2.md
└── ...
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Scheduler  │────▶│   Collector  │────▶│   Analyzer  │
└─────────────┘     └──────────────┘     └─────────────┘
                                                   │
                     ┌──────────────┐            │
                     │   Installer   │◀───────────┤
                     └──────────────┘            │
                           │                      │
                     ┌──────────────┐            │
                     │    Notes     │◀───────────┘
                     └──────────────┘
```

## Learning Sources

| Source | Description            |
| ------ | ---------------------- |
| search | Web search via Exa API |
| arxiv  | Academic papers        |
| github | Code repositories      |

## Value Scoring

Items are scored 0-100 based on:

- Source type (arxiv +20, github +15)
- Tag relevance (+5 per tag)
- Code references (+10)

Actions:

- Score ≥ 80: Install as Skill
- Score ≥ 60: Generate Code Suggestion
- Score < 60: Note only
