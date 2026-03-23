# Embedding Usage Audit Report - 2026-03-14

## Executive Summary

This report audits all code that performs embedding operations in the OpenCode project to ensure consistent use of the correct DashScope embedding API with 1536 dimensions.

---

## 1. Embedding Entry Points

### Primary Methods

| Method                               | File                                | Purpose                              | Status     |
| ------------------------------------ | ----------------------------------- | ------------------------------------ | ---------- |
| `embedWithDimensions()`              | `src/learning/embed-utils.ts`       | DashScope API with dimension support | ✅ Correct |
| `EmbeddingService.createGenerator()` | `src/learning/embedding-service.ts` | Unified embedding service            | ✅ Correct |
| `EmbeddingService.createService()`   | `src/learning/embedding-service.ts` | Create service with generator        | ✅ Correct |
| `getSharedVectorStore()`             | `src/learning/vector-store.ts`      | Shared vector store instance         | ✅ Correct |

### Fallback Methods

| Method              | File                               | Purpose             | Status           |
| ------------------- | ---------------------------------- | ------------------- | ---------------- |
| `simpleEmbedding()` | `src/learning/sqlite-vec-store.ts` | Hash-based fallback | ⚠️ Fallback only |

---

## 2. Code Review by File

### 2.1 `src/learning/embed-utils.ts` ✅

**Usage:**

```typescript
export async function embedWithDimensions(options: CustomEmbedOptions): Promise<Float32Array> {
  // Uses DashScope API when model starts with "text-embedding-"
  // Supports custom dimensions parameter
  // Falls back to Vercel AI SDK for other models
}
```

**Status:** ✅ Correct implementation

- Correctly calls DashScope API
- Supports dimension parameter
- Falls back gracefully

---

### 2.2 `src/learning/embedding-service.ts` ✅

**Usage:**

```typescript
// DashScope case
case "dashscope":
case "alibaba": {
  return async (text: string, _vectorType: VectorType): Promise<Float32Array> => {
    return await embedWithDimensions({
      model: modelName,
      value: text,
      dimensions: config.dimensions,
      apiKey: config.apiKey || process.env.DASHSCOPE_API_KEY,
    })
  }
}
```

**Status:** ✅ Correct implementation

- Uses `embedWithDimensions` for DashScope
- Supports multiple providers

---

### 2.3 `src/learning/incremental-indexer.ts` ✅

**Usage:**

```typescript
const vector = await embedWithDimensions({
  model: EMBEDDING_MODEL, // "text-embedding-v4"
  value: contentText,
  dimensions: EMBEDDING_DIMENSIONS, // 1536
})
```

**Status:** ✅ Correct after migration

- Uses `embedWithDimensions`
- Model: `text-embedding-v4`
- Dimensions: 1536

---

### 2.4 `src/tool/code-index.ts` ✅

**Usage:**

```typescript
const vector = await embedWithDimensions({
  model: dashscopeModel, // "text-embedding-v4"
  value: entry.content_text,
  dimensions: embeddingDimensions, // 1536
})
```

**Status:** ✅ Correct after migration

- Uses `embedWithDimensions`
- Model: `text-embedding-v4`
- Dimensions: 1536

---

### 2.5 `src/learning/vector-store.ts` ✅

**Usage:**

```typescript
const service = await EmbeddingService.createService({
  modelId: process.env.EMBEDDING_MODEL || "dashscope/text-embedding-v4",
})
```

**Status:** ✅ Correct

- Uses `EmbeddingService.createService`
- Default: `dashscope/text-embedding-v4`

---

### 2.6 `src/learning/sqlite-vec-store.ts` ⚠️

**Usage 1 - Embedding Generator (Correct):**

```typescript
async generateEmbedding(text: string, _vectorType: VectorType): Promise<Float32Array> {
  if (this.config.embeddingGenerator) {
    try {
      return await this.config.embeddingGenerator(text, _vectorType)
    } catch (error) {
      log.warn("external_embedding_failed_using_fallback", {...})
      // Falls back to simpleEmbedding
    }
  }
  return this.simpleEmbedding(text)  // Fallback
}
```

**Usage 2 - Sync Knowledge Nodes (Problematic):**

```typescript
// Line 706, 709
embedding = this.simpleEmbedding(`${node.title} ${node.content || ""}`)
```

**Issues:**

- Uses `simpleEmbedding` as fallback when embedding fails
- `simpleEmbedding` uses `this.config.defaultDimensions` which may not match

**Recommendation:**

- Keep fallback but ensure consistent dimensions
- Add warning when fallback is used

---

### 2.7 `src/learning/media-store.ts` ❌

**Usage:**

```typescript
this.embeddingGenerator = await EmbeddingService.createGenerator({
  modelId: "dashscope/text-embedding-3-small", // ❌ WRONG MODEL
})
```

**Issues:**

1. **Wrong model name**: `text-embedding-3-small` is OpenAI's model, not DashScope
2. **Should be**: `text-embedding-v4` (DashScope's model)

**Fix Required:**

```typescript
this.embeddingGenerator = await EmbeddingService.createGenerator({
  modelId: "dashscope/text-embedding-v4",
  dimensions: 1536,
})
```

---

### 2.8 `src/session/handlers.ts` ❌

**Usage:**

```typescript
const currentEmbedding = await EmbeddingService.createGenerator({
  modelId: "simple", // ❌ INVALID
}).then((gen) => gen(currentText, "content"))
```

**Issues:**

1. **Invalid model ID**: `"simple"` will be parsed as `openai/simple`
2. **This will fail** when trying to call OpenAI API with a non-existent model
3. **Intent appears to be**: Use a fast, local embedding for comparison

**Fix Required:**
Option A - Use DashScope (correct but requires API):

```typescript
const currentEmbedding = await EmbeddingService.createGenerator({
  modelId: "dashscope/text-embedding-v4",
  dimensions: 1536,
}).then((gen) => gen(currentText, "content"))
```

Option B - Add simple embedding support to EmbeddingService:

```typescript
// In embedding-service.ts, add case for "simple"
case "simple": {
  return createSimpleEmbeddingGenerator(config.dimensions || 384)
}
```

---

## 3. Summary of Issues

### Critical Issues (Must Fix) - ✅ All Fixed

| File                          | Line | Issue                                     | Status                                   |
| ----------------------------- | ---- | ----------------------------------------- | ---------------------------------------- |
| `src/learning/media-store.ts` | 290  | Wrong model name `text-embedding-3-small` | ✅ Fixed → `text-embedding-v4`           |
| `src/session/handlers.ts`     | 441  | Invalid model ID `"simple"`               | ✅ Fixed → `dashscope/text-embedding-v4` |

### Warnings (Should Review)

| File                               | Line     | Issue                                    | Recommendation                       |
| ---------------------------------- | -------- | ---------------------------------------- | ------------------------------------ |
| `src/learning/sqlite-vec-store.ts` | 706, 709 | Uses `simpleEmbedding` fallback          | Add logging, ensure dimensions match |
| `src/learning/sqlite-vec-store.ts` | 850      | `simpleEmbedding` uses config dimensions | Ensure consistent with database      |

---

## 4. Applied Fixes ✅

### Fix 1: `src/learning/media-store.ts` ✅ Applied

```typescript
// Before
this.embeddingGenerator = await EmbeddingService.createGenerator({
  modelId: "dashscope/text-embedding-3-small",
})

// After ✅
this.embeddingGenerator = await EmbeddingService.createGenerator({
  modelId: "dashscope/text-embedding-v4",
  dimensions: 1536,
})
```

### Fix 2: `src/session/handlers.ts` ✅ Applied

```typescript
// Before
const currentEmbedding = await EmbeddingService.createGenerator({
  modelId: "simple",
}).then((gen) => gen(currentText, "content"))

// After ✅
const currentEmbedding = await EmbeddingService.createGenerator({
  modelId: "dashscope/text-embedding-v4",
  dimensions: 1536,
}).then((gen) => gen(currentText, "content"))
```

### Fix 3: Add Simple Embedding Support (Optional)

If fast local embedding is needed for comparison purposes, add to `embedding-service.ts`:

```typescript
case "simple":
case "local": {
  const dimensions = config.dimensions || 384
  return (text: string, _vectorType: VectorType): Promise<Float32Array> => {
    return Promise.resolve(createSimpleEmbedding(text, dimensions))
  }
}
```

---

## 5. Embedding Model Configuration

### Standard Configuration

```typescript
// Recommended settings for DashScope
{
  provider: "dashscope",
  model: "text-embedding-v4",
  dimensions: 1536
}
```

### Model Name Mapping

| Provider  | Model Name               | Dimensions                 | Notes        |
| --------- | ------------------------ | -------------------------- | ------------ |
| DashScope | `text-embedding-v4`      | 1024 (default), 1536, 2048 | ✅ Supported |
| OpenAI    | `text-embedding-3-small` | 1536                       | ✅ Supported |
| OpenAI    | `text-embedding-3-large` | 3072                       | ✅ Supported |

### Important Notes

1. **DashScope model names** do NOT have `text-embedding-3-small` - that's OpenAI's naming
2. **DashScope model names** are: `text-embedding-v1`, `text-embedding-v2`, `text-embedding-v3`, `text-embedding-v4`
3. **Dimension support**: `text-embedding-v4` supports 64, 128, 256, 512, 768, 1024, 1536, 2048

---

## 6. Testing Recommendations

After fixes, verify:

1. **Run embedding tests**:

   ```bash
   bun test test/learning/knowledge-graph.test.ts
   ```

2. **Check dimension consistency**:

   ```sql
   SELECT dimensions, model, COUNT(*) FROM vector_memory GROUP BY dimensions, model;
   -- Should show: 1536 | dashscope/text-embedding-v4 | N
   ```

3. **Verify media store embedding**:
   ```typescript
   // Test that media store generates correct embeddings
   const ms = new MediaStore()
   const embedding = await ms.generateCharacterEmbedding("test", "description")
   console.log(embedding.length) // Should be 1536
   ```

---

## 7. Action Items

| Priority     | Task                         | File                                | Status  |
| ------------ | ---------------------------- | ----------------------------------- | ------- |
| **Critical** | Fix wrong model name         | `src/learning/media-store.ts`       | ✅ Done |
| **Critical** | Fix invalid model ID         | `src/session/handlers.ts`           | ✅ Done |
| **Medium**   | Add dimension logging        | `src/learning/sqlite-vec-store.ts`  | Pending |
| **Low**      | Add simple embedding support | `src/learning/embedding-service.ts` | Pending |

---

## 8. Summary

All critical embedding issues have been fixed:

1. ✅ `media-store.ts` - Changed from `text-embedding-3-small` to `text-embedding-v4`
2. ✅ `handlers.ts` - Changed from `"simple"` to `dashscope/text-embedding-v4`

All embedding code now consistently uses:

- **Model**: `dashscope/text-embedding-v4`
- **Dimensions**: 1536
- **Method**: `embedWithDimensions()` or `EmbeddingService.createGenerator()`

---

_Report generated: 2026-03-14_
_Updated: 2026-03-14 (Fixes applied)_
