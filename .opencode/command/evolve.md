---
description: Trigger OpenCode self-evolution system - collect, analyze, evolve
---

Trigger the OpenCode self-evolution system to:

1. Collect new information from web (arXiv, GitHub, PyPI)
2. Analyze and plan improvements
3. Generate deployment tasks
4. Optionally execute them via ZeroClaw

**Usage:**

- `/evolve` - Run full self-evolution cycle (collect → analyze → create tasks)
- `/evolve --execute` - Also execute pending deployment tasks
- `/evolve --status` - Show current evolution status
- `/evolve --check` - Check for issues without making changes

**What it does:**

1. **Research**: Search for latest AI/agent research and tools
2. **Analyze**: Score and filter based on relevance
3. **Plan**: Create improvement proposals
4. **Execute** (with --execute): Run ZeroClaw to apply changes

**Safety features:**

- Cooldown period (24h between major evolutions)
- Golden snapshot before each change
- Automatic rollback on failure
- Human review for large changes

**Examples:**

```
/evolve
/evolve --execute
/evolve --status
```

$ARGUMENTS

If no arguments provided, run full evolution cycle and report results.
