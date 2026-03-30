import { embed, embedMany } from "ai"
import { Log } from "../util/log"
import { Global } from "../global"
import type { EmbeddingGenerator, VectorType } from "./vector-store-interface"
import { getConfiguredEmbeddingDim, storeEmbeddingDim, Database } from "../storage/db"
import { embedWithDimensions } from "./embed-utils"
import { getEmbeddingApiKey } from "./embedding-config-loader"

export namespace EmbeddingService {
  const log = Log.create({ service: "embedding" })

  /**
   * Known embedding models with their dimensions
   * This serves as a fallback when we can't detect dimensions automatically
   */
  export const KNOWN_EMBEDDING_DIMENSIONS: Record<string, number> = {
    // OpenAI
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,

    // Cohere
    "embed-english-v3.0": 1024,
    "embed-multilingual-v3.0": 1024,
    "embed-english-light-v3.0": 384,
    "embed-multilingual-light-v3.0": 384,

    // Voyage AI
    "voyage-3": 1024,
    "voyage-3-lite": 512,
    "voyage-code-3": 1024,
    "voyage-large-2-instruct": 1536,
    "voyage-law-2": 1024,
    "voyage-code-2": 1536,
    "voyage-2": 1024,

    // Google
    "text-embedding-004": 768,
    "text-embedding-005": 768,
    "text-multilingual-embedding-002": 768,

    // Mistral
    "mistral-embed": 1024,

    // Nomic
    "nomic-embed-text-v1": 768,
    "nomic-embed-text-v1.5": 768,

    // E5 models
    "intfloat/e5-small-v2": 384,
    "intfloat/e5-base-v2": 768,
    "intfloat/e5-large-v2": 1024,
    "intfloat/multilingual-e5-small": 384,
    "intfloat/multilingual-e5-base": 768,
    "intfloat/multilingual-e5-large": 1024,
    "intfloat/multilingual-e5-large-instruct": 1024,

    // BGE models
    "BAAI/bge-small-en-v1.5": 384,
    "BAAI/bge-base-en-v1.5": 768,
    "BAAI/bge-large-en-v1.5": 1024,
    "BAAI/bge-m3": 1024,

    // Qwen embedding models
    "Qwen/Qwen3-Embedding-8B": 4096,

    // Jina
    "jina-embeddings-v2-base-en": 768,
    "jina-embeddings-v2-small-en": 512,
    "jina-embeddings-v3": 1024,

    // DeepSeek
    "deepseek-embedding": 1536,

    // Default fallback
    default: 1536,
  }

  /**
   * Embedding model configuration
   */
  export interface EmbeddingModelConfig {
    /** Model ID in format "provider/model" or just "model" */
    modelId: string
    /** Provider ID (optional, extracted from modelId if not provided) */
    providerId?: string
    /** Known dimensions (optional, auto-detected if not provided) */
    dimensions?: number
    /** API key (optional, uses environment if not provided) */
    apiKey?: string
    /** Base URL (optional, for custom endpoints) */
    baseURL?: string
    /** Additional options */
    options?: Record<string, unknown>
  }

  /**
   * Detected embedding model info
   */
  export interface EmbeddingModelInfo {
    modelId: string
    providerId: string
    dimensions: number
    fullModelId: string
  }

  /**
   * Parse model ID into provider and model
   */
  function parseModelId(modelId: string): { providerId: string; modelId: string; fullModelId: string } {
    const parts = modelId.split("/")
    if (parts.length === 2) {
      return { providerId: parts[0], modelId: parts[1], fullModelId: modelId }
    }
    // Default provider
    return { providerId: "openai", modelId: modelId, fullModelId: `openai/${modelId}` }
  }

  /**
   * Get known dimensions for a model
   * Returns undefined if not in known list
   */
  export function getKnownDimensions(modelId: string): number | undefined {
    const { modelId: modelName } = parseModelId(modelId)

    // Try exact match first
    if (KNOWN_EMBEDDING_DIMENSIONS[modelName]) {
      return KNOWN_EMBEDDING_DIMENSIONS[modelName]
    }

    // Try with full model ID
    if (KNOWN_EMBEDDING_DIMENSIONS[modelId]) {
      return KNOWN_EMBEDDING_DIMENSIONS[modelId]
    }

    // Try partial match for model names with version
    for (const [key, dim] of Object.entries(KNOWN_EMBEDDING_DIMENSIONS)) {
      if (modelName.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(modelName.toLowerCase())) {
        return dim
      }
    }

    return undefined
  }

  /**
   * Detect embedding model dimensions
   * Priority: explicit config > known models > API probe > default
   */
  export async function detectDimensions(config: EmbeddingModelConfig): Promise<number> {
    // 1. Explicit dimensions provided
    if (config.dimensions) {
      log.info("embedding_dimensions_from_config", { dimensions: config.dimensions })
      return config.dimensions
    }

    // 2. Check known models
    const knownDim = getKnownDimensions(config.modelId)
    if (knownDim) {
      log.info("embedding_dimensions_from_known_models", {
        modelId: config.modelId,
        dimensions: knownDim,
      })
      return knownDim
    }

    // 3. Try to probe from API (by embedding a test string)
    try {
      const generator = await createGenerator(config)
      const testEmbedding = await generator("test", "content")
      const detectedDim = testEmbedding.length
      log.info("embedding_dimensions_from_api_probe", {
        modelId: config.modelId,
        dimensions: detectedDim,
      })
      return detectedDim
    } catch (error) {
      log.warn("embedding_dimensions_probe_failed", {
        modelId: config.modelId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // 4. Fallback to default
    const defaultDim = KNOWN_EMBEDDING_DIMENSIONS["default"]
    log.warn("embedding_dimensions_using_default", {
      modelId: config.modelId,
      dimensions: defaultDim,
    })
    return defaultDim
  }

  /**
   * Create an embedding generator function
   */
  export async function createGenerator(config: EmbeddingModelConfig): Promise<EmbeddingGenerator> {
    const { providerId, modelId: modelName, fullModelId } = parseModelId(config.modelId)
    const provider = providerId || config.providerId || "openai"

    // Dynamic import based on provider
    let embeddingModel: any

    try {
      switch (provider) {
        case "openai": {
          const { createOpenAI } = await import("@ai-sdk/openai")
          const client = createOpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            ...config.options,
          })
          embeddingModel = client.textEmbeddingModel(modelName)
          break
        }
        case "anthropic": {
          // Anthropic doesn't have native embedding, use via OpenAI-compatible or fallback
          const { createOpenAI } = await import("@ai-sdk/openai")
          const client = createOpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseURL || "https://api.anthropic.com/v1",
            ...config.options,
          })
          embeddingModel = client.textEmbeddingModel(modelName)
          break
        }
        case "google":
        case "google-vertex": {
          const { createGoogleGenerativeAI } = await import("@ai-sdk/google")
          const client = createGoogleGenerativeAI({
            apiKey: config.apiKey,
            ...config.options,
          })
          embeddingModel = client.textEmbeddingModel(modelName)
          break
        }
        case "cohere": {
          const { createCohere } = await import("@ai-sdk/cohere")
          const client = createCohere({
            apiKey: config.apiKey,
            ...config.options,
          })
          embeddingModel = client.textEmbeddingModel(modelName)
          break
        }
        case "mistral": {
          const { createMistral } = await import("@ai-sdk/mistral")
          const client = createMistral({
            apiKey: config.apiKey,
            ...config.options,
          })
          embeddingModel = client.textEmbeddingModel(modelName)
          break
        }
        case "dashscope":
        case "alibaba": {
          // Alibaba Cloud DashScope - use embedWithDimensions to support dimensions parameter
          return async (text: string, _vectorType: VectorType): Promise<Float32Array> => {
            try {
              // 统一配置加载：按优先级读取 explicit > env > dotenv > config-file > default
              const effectiveApiKey = config.apiKey || (await getEmbeddingApiKey({ apiKey: config.apiKey }))
              return await embedWithDimensions({
                model: modelName,
                value: text,
                dimensions: config.dimensions,
                apiKey: effectiveApiKey,
              })
            } catch (error) {
              log.error("dashscope_embedding_failed", {
                error: error instanceof Error ? error.message : String(error),
              })
              throw error
            }
          }
        }
      }

      return async (text: string, _vectorType: VectorType): Promise<Float32Array> => {
        const { embedding } = await embed({
          model: embeddingModel,
          value: text,
        })
        return new Float32Array(embedding)
      }
    } catch (error) {
      log.error("embedding_model_creation_failed", {
        provider,
        modelId: modelName,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Create embedding generator for multiple texts (batch mode)
   */
  export async function createBatchGenerator(config: EmbeddingModelConfig): Promise<{
    single: EmbeddingGenerator
    batch: (texts: string[]) => Promise<Float32Array[]>
  }> {
    const singleGenerator = await createGenerator(config)
    const { providerId, modelId: modelName } = parseModelId(config.modelId)
    const provider = providerId || config.providerId || "openai"

    let embeddingModel: any

    // Re-create the model for batch operations
    switch (provider) {
      case "openai": {
        const { createOpenAI } = await import("@ai-sdk/openai")
        const client = createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL,
          ...config.options,
        })
        embeddingModel = client.textEmbeddingModel(modelName)
        break
      }
      default: {
        const { createOpenAI } = await import("@ai-sdk/openai")
        const client = createOpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL,
          ...config.options,
        })
        embeddingModel = client.textEmbeddingModel(modelName)
      }
    }

    return {
      single: singleGenerator,
      batch: async (texts: string[]): Promise<Float32Array[]> => {
        const { embeddings } = await embedMany({
          model: embeddingModel,
          values: texts,
        })
        return embeddings.map((e) => new Float32Array(e))
      },
    }
  }

  /**
   * Auto-configure embedding dimension in the system
   * This ensures the database is aware of the embedding dimension
   */
  export async function autoConfigureDimensions(config: EmbeddingModelConfig): Promise<{
    dimensions: number
    wasConfigured: boolean
  }> {
    const dimensions = await detectDimensions(config)
    const currentDim = getConfiguredEmbeddingDim()

    if (currentDim !== dimensions) {
      // Store new dimension in database using raw SQLite connection
      const sqlite = Database.raw()
      storeEmbeddingDim(sqlite, dimensions)

      // Note: Environment variable update removed - use config file instead
      log.info("embedding_dimensions_auto_configured", {
        previousDimension: currentDim,
        newDimension: dimensions,
        modelId: config.modelId,
      })

      return { dimensions, wasConfigured: true }
    }

    return { dimensions, wasConfigured: false }
  }

  /**
   * Get current configured embedding dimension
   */
  export function getConfiguredDimension(): number {
    return getConfiguredEmbeddingDim()
  }

  /**
   * Create a fully configured embedding service
   * This combines model detection, dimension configuration, and generator creation
   */
  export async function createService(config: EmbeddingModelConfig): Promise<{
    generator: EmbeddingGenerator
    batchGenerator: (texts: string[]) => Promise<Float32Array[]>
    dimensions: number
    modelInfo: EmbeddingModelInfo
  }> {
    // Detect and configure dimensions
    const { dimensions, wasConfigured } = await autoConfigureDimensions(config)

    // Create generators
    const { single, batch } = await createBatchGenerator(config)

    const { providerId, modelId: modelName, fullModelId } = parseModelId(config.modelId)

    log.info("embedding_service_created", {
      modelId: fullModelId,
      dimensions,
      wasConfigured,
    })

    return {
      generator: single,
      batchGenerator: batch,
      dimensions,
      modelInfo: {
        modelId: modelName,
        providerId: providerId || config.providerId || "openai",
        dimensions,
        fullModelId,
      },
    }
  }
}

// Re-export types for convenient access
export type EmbeddingModelConfig = EmbeddingService.EmbeddingModelConfig
export type EmbeddingModelInfo = EmbeddingService.EmbeddingModelInfo
