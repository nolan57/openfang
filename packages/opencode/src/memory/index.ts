/**
 * Memory Service Module
 *
 * Provides a three-level memory architecture for AI agents:
 * - Session Memory: Temporary, session-scoped memories with TTL
 * - Evolution Memory: Long-term memories from self-evolution processes
 * - Project Memory: Project-level knowledge and patterns
 *
 * @example
 * ```typescript
 * import { Memory, MemoryService } from '@opencode-ai/memory'
 *
 * // Using the singleton
 * await Memory.init()
 * const results = await Memory.search({ query: 'typescript', limit: 5 })
 *
 * // Creating a new instance
 * const memory = new MemoryService()
 * await memory.init()
 * ```
 */

// Main service and singleton
export { Memory, MemoryService } from "./service"

// Error types
export {
  MissingParameterError,
  UnsupportedMemoryTypeError,
  ServiceNotInitializedError,
  SessionNotFoundError,
} from "./service"

// Result types
export type {
  MemoryResult,
  CrossMemoryResult,
  AddMemoryResult,
  SessionData,
  SessionMessage,
  ProjectNode,
  ProjectRelation,
  AdvancedSearchOptions,
  IndexProjectOptions,
} from "./service"

// Re-export memory type from collab types
export type { MemoryType, AddMemoryParams, SearchParams, MemoryRef } from "../collab/types"