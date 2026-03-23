import { Log } from "../util/log"

const log = Log.create({ service: "context-manager" })

export interface ContextChunk {
  id: string
  content: string
  tokenCount: number
  source: string
  relevance: number
  metadata: Record<string, any>
}

export interface ContextConfig {
  maxTokens: number
  chunkOverlap: number
  defaultChunkSize: number
  compressionThreshold: number
  enableRetrieval: boolean
  enableCompression: boolean
}

export const defaultContextConfig: ContextConfig = {
  maxTokens: 128000,
  chunkOverlap: 50,
  defaultChunkSize: 2000,
  compressionThreshold: 0.7,
  enableRetrieval: true,
  enableCompression: true,
}

export class ContextManager {
  private config: ContextConfig
  private chunks: Map<string, ContextChunk>

  constructor(config: Partial<ContextConfig> = {}) {
    this.config = { ...defaultContextConfig, ...config }
    this.chunks = new Map()
  }

  addChunk(chunk: Omit<ContextChunk, "tokenCount">): ContextChunk {
    const tokenCount = this.estimateTokens(chunk.content)
    const fullChunk: ContextChunk = { ...chunk, tokenCount }
    this.chunks.set(chunk.id, fullChunk)
    log.info("context_chunk_added", { id: chunk.id, tokens: tokenCount })
    return fullChunk
  }

  getChunk(id: string): ContextChunk | undefined {
    return this.chunks.get(id)
  }

  removeChunk(id: string): boolean {
    return this.chunks.delete(id)
  }

  getContextBudget(): { used: number; available: number; usagePercent: number } {
    let used = 0
    for (const chunk of this.chunks.values()) {
      used += chunk.tokenCount
    }
    return {
      used,
      available: this.config.maxTokens - used,
      usagePercent: (used / this.config.maxTokens) * 100,
    }
  }

  needsCompression(): boolean {
    const { usagePercent } = this.getContextBudget()
    return usagePercent > this.config.compressionThreshold * 100
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  clear(): void {
    this.chunks.clear()
    log.info("context_cleared")
  }

  getTotalChunks(): number {
    return this.chunks.size
  }

  getAllChunks(): ContextChunk[] {
    return Array.from(this.chunks.values()).sort((a, b) => b.relevance - a.relevance)
  }
}

export function createContextManager(config?: Partial<ContextConfig>): ContextManager {
  return new ContextManager(config)
}
