# AI Self-Learning Improvement System Design

## Goal

Enable opencode to periodically learn new theories, methods, and algorithms from the internet, and continuously improve itself by installing MCPs/Skills, generating notes, and suggesting code improvements.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Learning Scheduler                   │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                │
│  │ Cron    │  │  Idle   │  │ Manual  │                │
│  │ Schedule│  │ Detection│  │ Trigger │                │
│  └────┬────┘  └────┬────┘  └────┬────┘                │
│       └────────────┴────────────┘                     │
│                    ▼                                    │
│              Trigger Learning Task                      │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│                   Multi-Source Collector                │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐     │
│  │ Web    │  │ arXiv  │  │GitHub  │  │ Tech   │     │
│  │ Search │  │ Papers │  │ API    │  │ Blogs  │     │
│  └────┬───┘  └────┬───┘  └────┬───┘  └────┬───┘     │
│       └───────────┴───────────┴───────────┘           │
│                    ▼                                   │
│              Raw Content                                │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│                     Analysis Engine                    │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐     │
│  │Extract │  │ Analyze│  │Reason  │  │Suggest │     │
│  │Content │  │ Deeply │  │Summarize│ │Actions │     │
│  └────────┘  └────────┘  └────────┘  └────────┘     │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│                      Executor                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐      │
│  │Skill/MCP   │  │Learning    │  │Code       │      │
│  │Installer   │  │Notes       │  │Improvement│      │
│  └────────────┘  └────────────┘  └────────────┘      │
└─────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────┐
│               Knowledge Base (SQLite + Files)           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │Learning  │  │Extracted │  │Skills    │              │
│  │Records   │  │Knowledge │  │Registry  │              │
│  └──────────┘  └──────────┘  └──────────┘              │
└─────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Learning Scheduler

- **Cron Schedule**: 2-3 times per week, triggered at configured times
- **Idle Detection**: Monitor opencode idle state, trigger when idle
- **Manual Trigger**: Support `/learn` or similar command for immediate execution

Config example (`config/learning.json`):

```json
{
  "schedule": {
    "cron": "0 10 * * 1,3,5",
    "idleCheck": true,
    "idleThresholdMinutes": 30
  },
  "sources": ["search", "arxiv", "github", "blogs"],
  "topics": ["AI", "code generation", "agent systems"]
}
```

### 2. Multi-Source Collector

| Source | Tool             | Description          |
| ------ | ---------------- | -------------------- |
| Search | Tavily API / Exa | General web search   |
| Papers | arXiv API        | Academic papers      |
| Code   | GitHub API       | Open source projects |
| Blogs  | RSS / Crawler    | Tech articles        |

### 3. Analysis Engine

- **Content Extraction**: Use webfetch/summarize to extract key points
- **Deep Analysis**: Extract methods, algorithms, core theories
- **Reasoning Summary**: Evaluate value to opencode
- **Action Suggestions**: Generate actionable recommendations

### 4. Executor

| Action          | Trigger              | Description                                      |
| --------------- | -------------------- | ------------------------------------------------ |
| Install Skill   | High-value new skill | Auto-install to `~/.config/opencode/skills/`     |
| Register MCP    | Useful tool          | Call MCP registration API                        |
| Generate Notes  | Always               | Save to `docs/learning/`                         |
| Code Suggestion | Needs improvement    | Generate PR/modification (requires confirmation) |

### 5. Knowledge Base

SQLite tables:

- `learning_runs`: Learning records (time, source, topics)
- `knowledge`: Extracted knowledge entries
- `skills`: Installed/available skills registry
- `actions`: Executed action logs

File storage:

- `docs/learning/notes/`: Learning notes in Markdown
- `docs/learning/summaries/`: Periodic summaries

## Data Flow

1. **Trigger** → Scheduler checks execution conditions
2. **Collect** → Collector fetches content from configured sources
3. **Analyze** → Analyzer processes content, extracts knowledge
4. **Evaluate** → Evaluate each knowledge point's value and action
5. **Execute** → Executor performs recommended actions
6. **Store** → Record to knowledge base, generate notes

## Security Considerations

1. **Code changes require confirmation**: Any code modifications need user approval
2. **Skill installation verification**: Check skill source and signature
3. **Network access restriction**: Only whitelist allowed domains
4. **Operation logs**: All operations logged, can be rolled back

## Phases

- Phase 1: Scheduler + Collector + Note Generation
- Phase 2: Analysis Engine + Knowledge Base
- Phase 3: Skill/MCP Auto-Installation
- Phase 4: Code Improvement Suggestions

## Testing

- Unit tests: Each component tested independently
- Integration tests: Full flow testing
- Human evaluation: Learning result quality assessment
