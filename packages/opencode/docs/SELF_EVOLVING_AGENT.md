# Self-Evolving Agent Framework

> An autonomous agent framework that enables OpenCode to continuously improve itself through prompt optimization, skill generation, and memory enhancement.

## Overview

The Self-Evolving Agent Framework is an optional system that allows OpenCode to learn from session interactions and improve over time. It analyzes completed tasks, identifies reusable patterns, and creates persistent knowledge that can be leveraged in future sessions.

## Architecture

### Three-Layer Evolution System

```
┌─────────────────────────────────────────────────────────────┐
│                    Self-Evolving Agent                      │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Prompt Self-Optimization                          │
│  • Analyze session interactions                             │
│  • Generate prompt improvements                             │
│  • Store optimized prompts for future use                   │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Skill Dynamic Generation                          │
│  • Detect reusable task patterns                            │
│  • Auto-generate SKILL.md files                            │
│  • Require approval before activation                       │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Memory Enhancement                                │
│  • Extract learnings from sessions                          │
│  • Cross-session pattern recognition                        │
│  • Relevance-based memory retrieval                         │
└─────────────────────────────────────────────────────────────┘
```

### Data Storage

All evolution data is stored in JSON format under `.opencode/evolution/` in the project directory:

```
.opencode/evolution/
├── prompts.json    # Optimized prompts
├── skills.json     # Generated skills (draft/approved/rejected)
└── memories.json   # Learned patterns
```

## Implementation

### Core Modules

| Module      | File                           | Purpose                                                      |
| ----------- | ------------------------------ | ------------------------------------------------------------ |
| Types       | `src/evolution/types.ts`       | Zod schemas for PromptEvolution, SkillEvolution, MemoryEntry |
| Store       | `src/evolution/store.ts`       | File-based persistence operations                            |
| Prompt      | `src/evolution/prompt.ts`      | Session reflection and optimization suggestions              |
| Skill       | `src/evolution/skill.ts`       | Auto-generate and manage skills                              |
| Memory      | `src/evolution/memory.ts`      | Extract and retrieve memories                                |
| Integration | `src/evolution/integration.ts` | Session lifecycle hooks                                      |

### CLI Commands

The framework exposes the `evolve` command with subcommands:

```bash
# List all evolution artifacts
opencode evolve list

# List pending skill approvals
opencode evolve pending

# Approve and create a skill file
opencode evolve approve <skillID>

# Reject a skill proposal
opencode evolve reject <skillID>

# List learned memories
opencode evolve memories
```

## How It Works

### 1. Prompt Self-Optimization

After each session completes, the agent reflects on the interaction:

1. Analyzes task success/failure
2. Identifies missing instructions or unclear prompts
3. Generates optimized prompt suggestions
4. Stores improvements for relevant agent types

**Current Status:** Reflection is implemented but returns `shouldOptimize: false` by default (placeholder for future LLM integration).

### 2. Skill Dynamic Generation

The system analyzes tool usage patterns during sessions:

1. Tracks tool call frequency
2. Identifies when the same tool is used 3+ times
3. Generates a new skill based on the pattern
4. Saves as "draft" status (requires approval)

**Skill Generation Criteria:**

- 3+ repeated tool calls with same tool name
- Success status required

**Approval Workflow:**

```
Draft → [User Review] → Approved → Creates .opencode/skills/<name>/SKILL.md
                     → Rejected → Deleted
```

### 3. Memory Enhancement

Pattern-based memory extraction from sessions:

**Supported Patterns:**
| Pattern | Key | Value |
|---------|-----|-------|
| TypeScript tasks | `typescript-tips` | Use explicit type annotations |
| Testing tasks | `testing-approach` | Write tests first (TDD) |
| Refactoring tasks | `refactoring-guidance` | Make small, incremental changes |
| Debugging tasks | `debugging-tips` | Start with minimal reproduction |

**Retrieval:** When starting a new session, relevant memories are matched against task keywords.

## Usage Examples

### Example 1: Generating a Skill

```bash
# 1. Work on a task that involves repeated tool usage
$ opencode
> Fix all bugs in src/

# 2. Session ends, system detects pattern (3+ grep calls)
# 3. Skill proposal created as draft

# 4. Check pending skills
$ opencode evolve pending
=== Pending Skills ===
abc123: auto-grep-task - Auto-generated skill for grep operations

# 5. Review the skill
$ cat .opencode/evolution/skills.json

# 6. Approve to create actual skill file
$ opencode evolve approve abc123
Skill created at: /project/.opencode/skills/auto-grep-task/SKILL.md

# 7. Next time similar task runs, skill auto-loads
```

### Example 2: Memory Retrieval

```bash
# Start new session
$ opencode
> Write tests for auth module

# System checks memories for "test" keyword
# Suggests: "testing-approach: Write tests first (TDD)"
```

### Example 3: Viewing Evolution Data

```bash
$ opencode evolve list

=== Prompt Optimizations ===
1 optimizations

=== Generated Skills ===
[approved] auto-grep-task: Auto-generated skill for grep operations
[draft] auto-edit-task: Auto-generated skill for edit operations

=== Memories ===
3 memories

$ opencode evolve memories

[typescript-tips]
  Use explicit type annotations for better clarity
  Used 5 times
```

## Configuration

### Storage Location

Evolution data is stored at the **project level** (`.opencode/evolution/`), meaning:

- Data is shared with the project
- Committed to git if desired
- Different projects have independent evolution data

### Disabling the System

Currently always active. Future versions may add configuration options.

## Technical Details

### Zod Schemas

```typescript
// Prompt Evolution
{
  id: string
  originalPrompt: string
  optimizedPrompt: string
  reason: string
  sessionID: string
  createdAt: number
  usageCount: number
}

// Skill Evolution
{
  id: string
  name: string           // kebab-case
  description: string
  content: string        // SKILL.md content
  triggerPatterns: string[]
  sessionID: string
  createdAt: number
  status: "draft" | "approved" | "rejected"
}

// Memory Entry
{
  id: string
  key: string
  value: string
  context: string
  sessionIDs: string[]
  createdAt: number
  lastUsedAt: number
  usageCount: number
}
```

### File Operations

All read/write operations use `fs/promises` with error handling:

- Reads return empty arrays on file not found
- Writes log errors and rethrow
- Automatic directory creation

## Testing

```bash
# Run evolution tests
bun test test/evolution/

# Test results
24 pass, 0 fail
```

## Future Enhancements

1. **LLM-Powered Reflection**: Integrate actual LLM calls for prompt optimization
2. **Configuration Options**: Toggle evolution features on/off
3. **User-Level Storage**: Option for global evolution data
4. **Auto-Approval Rules**: Regex-based automatic skill approval
5. **Session Integration**: Automatic evolution triggers on session complete

## Related Files

- `src/evolution/` - Core implementation
- `src/cli/cmd/evolve.ts` - CLI commands
- `test/evolution/` - Test suite
- `docs/plans/2026-02-26-self-evolving-agent.md` - Implementation plan
