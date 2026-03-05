# Self-Evolution Data Collection Analysis

This document analyzes how the self-evolution system fetches data and determines what to modify.

---

## Overview

The user asked: **"Does the system randomly fetch data and randomly decide what to modify?"**

**Short Answer**: **No, it is NOT random.** The system uses a **configurable topic-based approach** with structured data sources.

---

## How It Works

### 1. Configuration-Based Topics

The system does **NOT** randomly choose what to learn. It uses predefined topics from configuration:

**File**: `packages/opencode/src/learning/config.ts`

```typescript
export const defaultLearningConfig: LearningConfig = {
  enabled: true,
  sources: ["search", "arxiv", "github"],
  topics: ["AI", "code generation", "agent systems"], // ← Defined topics
  max_items_per_run: 10,
}
```

**Topics are fixed**:

- "AI"
- "code generation"
- "agent systems"

These topics determine what information is collected.

---

### 2. Data Sources

The system collects from **4 structured sources**:

| Source           | Query Pattern                                 | Purpose            |
| ---------------- | --------------------------------------------- | ------------------ |
| **search** (Exa) | `{topic} 2024 2025`                           | General web search |
| **arxiv** (Exa)  | `site:arxiv.org {topic}`                      | Academic papers    |
| **github** (Exa) | `site:github.com {topic} language:typescript` | Code repositories  |
| **pypi**         | Package search                                | Python libraries   |

**Each topic is queried against each source**, so for 3 topics × 4 sources = 12 queries per run.

---

### 3. Collection Process

**File**: `packages/opencode/src/learning/collector.ts`

```typescript
async collect(): Promise<CollectedItem[]> {
  const items: CollectedItem[] = []

  for (const topic of this.config.topics) {
    if (this.config.sources.includes("search")) {
      const searchResults = await this.collectFromSearch(topic)  // Uses topic!
      items.push(...searchResults)
    }
    // ... other sources
  }

  return items.slice(0, this.config.max_items_per_run)  // Limited to 10
}
```

**Flow**:

1. For each topic in config → query each enabled source
2. Results are collected and limited to `max_items_per_run` (default: 10)
3. Results are analyzed by the Analyzer
4. Actions are determined based on content analysis

---

### 4. What Happens to Collected Data

**File**: `packages/opencode/src/learning/command.ts`

After collection:

```typescript
const analyzed = await analyzer.analyze(items)

await store.saveKnowledge(analyzed) // Save to knowledge base

const notes = await noteGen.generate(analyzed) // Generate notes

const installResults = await installer.install(analyzed) // Install skills

const suggestions = await suggester.generateSuggestions(analyzed) // Code suggestions
```

**Possible Actions** (determined by Analyzer):

- `install_skill` → Install new skill
- `code_suggestion` → Suggest code improvements
- `note` → Generate learning notes
- No action

---

### 5. Trigger Mechanism

**File**: `packages/opencode/src/learning/evolution-trigger.ts`

The system **monitors** for:

1. **Recent code changes** (files modified in last 30 minutes)
2. **New skills** loaded in the last hour
3. **Consistency issues** (conflicts, outdated data)

```typescript
private async detectCodeChanges(): Promise<...> {
  const recentChanges = recentNodes.filter((n) => {
    const lastChanged = n.metadata?.last_changed as number
    return lastChanged && lastChanged > thirtyMinutesAgo  // Last 30 min only
  })
  // Creates tasks for recent changes
}
```

---

## Summary: Random or Not?

| Aspect               | Random?        | Explanation                                                     |
| -------------------- | -------------- | --------------------------------------------------------------- |
| **Topics to search** | ❌ No          | Hardcoded in config: ["AI", "code generation", "agent systems"] |
| **Data sources**     | ❌ No          | Configurable: search, arxiv, github, pypi                       |
| **What to modify**   | ❌ No          | Based on: recent code changes, new skills, consistency checks   |
| **When to trigger**  | ⚠️ Semi-random | Based on idle detection + scheduled intervals                   |

---

## Key Findings

1. **Not Random**: The system follows a **deterministic, configuration-driven approach**

2. **Topic-Driven**: Everything starts from the predefined topics in config

3. **Source-Diverse**: Uses multiple sources (web search, academic papers, GitHub, PyPI) to gather relevant information

4. **Action-Based**: What modifications happen depend on:
   - What skills were installed
   - What code changes were detected
   - What consistency issues exist

5. **Human-in-the-Loop**:
   - Skills require manual approval (`require_human_review_for_skills: true`)
   - Code changes need review before deployment

---

## Configuration

Users can customize:

```typescript
// In config
topics: ["AI", "code generation", "agent systems"] // What to learn about
sources: ["search", "arxiv", "github"] // Where to learn from
max_items_per_run: 10 // How much per run

// In trigger config
auto_approve_small_changes: true // Auto-approve small changes
small_change_threshold_lines: 20 // What counts as "small"
require_human_review_for_skills: true // Skills need approval
```

---

## Conclusion

**The self-evolution system is NOT random.** It is a **structured, configurable system** that:

1. Searches for information on predefined topics
2. Collects from specific sources (not random URLs)
3. Makes modifications based on detected needs (recent changes, new skills, consistency)
4. Requires human approval for sensitive actions (skills)

The system is designed to learn about **AI, code generation, and agent systems** specifically - not random topics.
