# LLM Wrapper Migration Guide

## Overview

This guide explains how to migrate existing LLM calls in the Novel Engine to use the new unified `llm-wrapper.ts` module.

## Why Use the LLM Wrapper?

The new `novelLLM` wrapper provides:

1. **Consistent Model Acquisition**: All calls use `getNovelLanguageModel()` with the same fallback chain
2. **Unified Error Handling**: Standardized error messages and logging
3. **Built-in Retry**: Automatic retry with exponential backoff
4. **Observability Integration**: Ready for tracing and metrics collection
5. **JSON Parsing**: Automatic JSON extraction and validation
6. **Batch Processing**: Efficient parallel LLM calls
7. **Rate Limiting**: Built-in protection against API rate limits

## Migration Steps

### Step 1: Identify Current LLM Calls

Current pattern in the codebase:

```typescript
import { generateText } from "ai"
import { getNovelLanguageModel } from "./model"

const languageModel = await getNovelLanguageModel()
const result = await generateText({
  model: languageModel,
  prompt: "...",
})
```

### Step 2: Replace with LLM Wrapper

New pattern:

```typescript
import { callLLM } from "./llm-wrapper"

const result = await callLLM({
  prompt: "...",
  callType: "my_operation",
})
```

### Step 3: Update All LLM Call Sites

#### Basic Text Generation

**Before:**

```typescript
const languageModel = await getNovelLanguageModel()
const result = await generateText({
  model: languageModel,
  prompt: "Generate story continuation",
})
const storySegment = result.text
```

**After:**

```typescript
const result = await callLLM({
  prompt: "Generate story continuation",
  callType: "story_generation",
})
const storySegment = result.text
```

#### JSON Generation

**Before:**

```typescript
const languageModel = await getNovelLanguageModel()
const result = await generateText({
  model: languageModel,
  system: "Output JSON only",
  prompt: "Generate character state as JSON",
})

const jsonMatch = result.text.match(/\{[\s\S]*\}/)
const data = JSON.parse(jsonMatch[0])
```

**After:**

```typescript
const result = await callLLMJson<{ name: string; traits: string[] }>({
  prompt: "Generate character state",
  callType: "character_generation",
  schemaDescription: `{
    "name": string,
    "traits": string[]
  }`,
})
const data = result.data
```

#### With Custom Temperature

**Before:**

```typescript
const languageModel = await getNovelLanguageModel()
const result = await generateText({
  model: languageModel,
  prompt: "Write a poem",
  temperature: 0.9,
})
```

**After:**

```typescript
const result = await callLLM({
  prompt: "Write a poem",
  callType: "creative_writing",
  temperature: 0.9,
})
```

#### With Retry

**Before:**

```typescript
import { withRetry, RetryConfig } from "./validation"

const languageModel = await getNovelLanguageModel()
const result = await withRetry(
  () =>
    generateText({
      model: languageModel,
      prompt: "...",
    }),
  new RetryConfig({ maxRetries: 3 }),
)
```

**After:**

```typescript
const result = await callLLM({
  prompt: "...",
  callType: "retry_operation",
  useRetry: true,
  retryConfig: new RetryConfig({ maxRetries: 3 }),
})
```

#### Batch Processing

**Before:**

```typescript
const promises = items.map((item) =>
  generateText({
    model: languageModel,
    prompt: `Process ${item}`,
  }),
)
const results = await Promise.all(promises)
```

**After:**

```typescript
const calls = items.map(item => ({
  prompt: `Process ${item}`,
  callType: "batch_item",
}))
const results = await callLLMBatch(calls, concurrency: 3)
```

## Module-Specific Migration

### state-extractor.ts

**Current LLM calls:** 3 locations

- Line ~150: State extraction
- Line ~226: Evaluation
- Line ~275: Proposed changes validation

**Migration:**

```typescript
// Replace each occurrence
const result = await callLLM({
  prompt: buildStateExtractionPrompt(...),
  callType: "state_extraction",
  useRetry: true,
})
```

### orchestrator.ts

**Current LLM calls:** ~11 locations

- Branch generation
- Branch evaluation
- Visual panel generation
- And more...

**Migration:**

```typescript
// For branch generation
const result = await callLLM({
  prompt: buildBranchPrompt(...),
  callType: "branch_generation",
  useRetry: true,
  retryConfig: new RetryConfig({ maxRetries: 2 }),
})
```

### pattern-miner-enhanced.ts

**Current LLM calls:** 3 locations

- Archetype extraction
- Plot template extraction
- Motif extraction

**Migration:**

```typescript
const result = await callLLMJson({
  prompt: buildArchetypePrompt(...),
  callType: "archetype_extraction",
  schemaDescription: "[{ characterName, archetypeType, ... }]",
})
```

### relationship-analyzer.ts

**Current LLM calls:** 4 locations

- Relationship analysis
- Dynamic analysis
- And more...

**Migration:**

```typescript
const result = await callLLMJson({
  prompt: buildRelationshipPrompt(...),
  callType: "relationship_analysis",
})
```

## Benefits of Migration

1. **Reduced Code Duplication**: No need to repeat model acquisition and error handling
2. **Better Observability**: All calls automatically logged with callType
3. **Consistent Retry Behavior**: All calls get the same retry strategy
4. **Easier Testing**: Can mock `callLLM` instead of multiple functions
5. **Future-Proof**: Easy to add new features (caching, rate limiting, etc.)

## Migration Checklist

- [ ] `state-extractor.ts` (3 calls)
- [ ] `orchestrator.ts` (11 calls)
- [ ] `pattern-miner-enhanced.ts` (3 calls)
- [ ] `pattern-miner.ts` (3 calls)
- [ ] `relationship-analyzer.ts` (4 calls)
- [ ] `relationship-inertia.ts` (1 call)
- [ ] `multiway-relationships.ts` (1 call)
- [ ] `motif-tracker.ts` (2 calls)
- [ ] `character-deepener.ts` (2 calls)
- [ ] `thematic-analyst.ts` (1 call)
- [ ] `narrative-skeleton.ts` (1 call)
- [ ] `visual-prompt-engineer.ts` (1 call)
- [ ] `evolution-rules.ts` (1 call)

**Total:** ~33 LLM calls to migrate

## Testing

After migration, run:

```bash
bun test src/novel --timeout 30000
```

All existing tests should pass without modification.

## Rollback

If needed, you can revert individual files:

```bash
git checkout HEAD -- packages/opencode/src/novel/<file>.ts
```

## Support

For questions or issues with migration, refer to:

- `packages/opencode/src/novel/llm-wrapper.ts` - Implementation
- `packages/opencode/src/novel/llm-wrapper.test.ts` - Usage examples
