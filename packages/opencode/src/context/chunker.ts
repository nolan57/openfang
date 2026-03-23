import { Log } from "../util/log"

const log = Log.create({ service: "context-chunker" })

export interface ChunkOptions {
  size?: number
  overlap?: number
  preserveStructure?: boolean
}

export interface ChunkResult {
  id: string
  content: string
  startIndex: number
  endIndex: number
  tokenCount: number
}

export class Chunker {
  private defaultSize: number
  private defaultOverlap: number

  constructor(options: ChunkOptions = {}) {
    this.defaultSize = options.size ?? 2000
    this.defaultOverlap = options.overlap ?? 50
  }

  chunkByTokens(text: string, options: ChunkOptions = {}): ChunkResult[] {
    const size = options.size ?? this.defaultSize
    const overlap = options.overlap ?? this.defaultOverlap
    const chunks: ChunkResult[] = []

    let start = 0
    let index = 0

    while (start < text.length) {
      const end = Math.min(start + size, text.length)
      let content = text.slice(start, end)

      if (options.preserveStructure) {
        content = this.preserveStructure(content, text, start)
      }

      chunks.push({
        id: `chunk-${index}`,
        content,
        startIndex: start,
        endIndex: end,
        tokenCount: Math.ceil(content.length / 4),
      })

      start = end - overlap
      index++
    }

    log.info("text_chunked", { textLength: text.length, chunks: chunks.length })
    return chunks
  }

  chunkByParagraphs(text: string, maxTokensPerChunk: number = 2000): ChunkResult[] {
    const paragraphs = text.split(/\n\n+/)
    const chunks: ChunkResult[] = []
    let currentChunk = ""
    let startIndex = 0
    let chunkIndex = 0

    for (const paragraph of paragraphs) {
      const paraTokens = Math.ceil(paragraph.length / 4)
      const currentTokens = Math.ceil(currentChunk.length / 4)

      if (currentTokens + paraTokens > maxTokensPerChunk && currentChunk.length > 0) {
        chunks.push({
          id: `chunk-${chunkIndex}`,
          content: currentChunk.trim(),
          startIndex,
          endIndex: startIndex + currentChunk.length,
          tokenCount: currentTokens,
        })
        chunkIndex++
        startIndex = text.indexOf(paragraph)
        currentChunk = paragraph
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + paragraph
      }
    }

    if (currentChunk.length > 0) {
      chunks.push({
        id: `chunk-${chunkIndex}`,
        content: currentChunk.trim(),
        startIndex,
        endIndex: text.length,
        tokenCount: Math.ceil(currentChunk.length / 4),
      })
    }

    return chunks
  }

  chunkSemantically(text: string, options: ChunkOptions = {}): ChunkResult[] {
    const boundaries = this.findSemanticBoundaries(text)
    return this.createChunksFromBoundaries(text, boundaries, options)
  }

  private preserveStructure(content: string, fullText: string, startIndex: number): string {
    const lines = content.split("\n")
    if (lines.length > 3) {
      const firstLines = lines.slice(0, 2).join("\n")
      const lastLines = lines.slice(-2).join("\n")
      return `${firstLines}\n[... ${lines.length - 4} lines ...]\n${lastLines}`
    }
    return content
  }

  private findSemanticBoundaries(text: string): number[] {
    const boundaries = [0]
    const patterns = [/^\#{1,6}\s/m, /^\*\*.+?\*\*/m, /^```/m, /^\d+\.\s/m, /^-{3,}$/m]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(text)) !== null) {
        boundaries.push(match.index)
      }
    }

    return [...new Set(boundaries)].sort((a, b) => a - b)
  }

  private createChunksFromBoundaries(text: string, boundaries: number[], options: ChunkOptions): ChunkResult[] {
    const size = options.size ?? this.defaultSize
    const chunks: ChunkResult[] = []

    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i]
      const end = Math.min(start + size, i < boundaries.length - 1 ? boundaries[i + 1] : text.length)

      chunks.push({
        id: `chunk-${i}`,
        content: text.slice(start, end),
        startIndex: start,
        endIndex: end,
        tokenCount: Math.ceil((end - start) / 4),
      })
    }

    return chunks
  }
}

export function createChunker(options?: ChunkOptions): Chunker {
  return new Chunker(options)
}
