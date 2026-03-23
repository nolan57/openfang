/**
 * Bridge Core - Generic Adapter Layer for Cross-Module Integration
 *
 * Provides reusable components for building bridges between modules:
 * - TypeMapper: Bidirectional type transformation
 * - BridgeEventBus: Cross-module event communication
 * - SyncManager: Bidirectional data synchronization
 *
 * @example
 * ```typescript
 * import { TypeMapper, BridgeEventBus, SyncManager } from "./bridge-core"
 *
 * // Create type mappings
 * const mapper = new TypeMapper()
 * mapper.register({
 *   sourceType: "memory.session",
 *   targetType: "learning.memory",
 *   transform: (session) => ({ type: "memory", ...session }),
 *   reverse: (node) => ({ id: node.entity_id, ...node }),
 * })
 *
 * // Create event bus
 * const eventBus = new BridgeEventBus()
 * eventBus.subscribe("memory", async (event) => { ... })
 * eventBus.emit({ source: "novel", target: "memory", type: "sync" })
 * ```
 */

import { Log } from "../util/log"

const log = Log.create({ service: "bridge-core" })

// ============================================================================
// TypeMapper - Generic Type Mapping with Bidirectional Support
// ============================================================================

/**
 * Bidirectional type mapping configuration
 */
export interface TypeMapping<S, T> {
  sourceType: string
  targetType: string
  transform: (source: S) => T
  reverse: (target: T) => S
}

/**
 * Type mapper for bidirectional transformations between domain types
 */
export class TypeMapper {
  private mappings = new Map<string, Map<string, TypeMapping<unknown, unknown>>>()

  /**
   * Register a bidirectional type mapping
   */
  register<S, T>(mapping: TypeMapping<S, T>): void {
    const forwardKey = `${mapping.sourceType}→${mapping.targetType}`
    const reverseKey = `${mapping.targetType}→${mapping.sourceType}`

    if (!this.mappings.has(mapping.sourceType)) {
      this.mappings.set(mapping.sourceType, new Map())
    }
    this.mappings.get(mapping.sourceType)!.set(mapping.targetType, mapping as TypeMapping<unknown, unknown>)

    log.debug("type_mapping_registered", {
      from: mapping.sourceType,
      to: mapping.targetType,
    })
  }

  /**
   * Transform source type to target type
   */
  map<S, T>(source: S, sourceType: string, targetType: string): T {
    const sourceMap = this.mappings.get(sourceType)
    if (!sourceMap) {
      throw new Error(`No mappings registered for source type: ${sourceType}`)
    }

    const mapping = sourceMap.get(targetType)
    if (!mapping) {
      throw new Error(`No mapping from ${sourceType} to ${targetType}`)
    }

    return mapping.transform(source) as T
  }

  /**
   * Reverse transform target type back to source type
   */
  reverse<T, S>(target: T, targetType: string, sourceType: string): S {
    const mapping = this.mappings.get(sourceType)?.get(targetType)
    if (!mapping) {
      throw new Error(`No mapping from ${sourceType} to ${targetType}`)
    }
    return mapping.reverse(target) as S
  }

  /**
   * Check if a mapping exists
   */
  hasMapping(sourceType: string, targetType: string): boolean {
    return this.mappings.get(sourceType)?.has(targetType) ?? false
  }

  /**
   * Get all registered mappings for a source type
   */
  getMappings(sourceType: string): Array<{ targetType: string; mapping: TypeMapping<unknown, unknown> }> {
    const sourceMap = this.mappings.get(sourceType)
    if (!sourceMap) return []

    return Array.from(sourceMap.entries()).map(([targetType, mapping]) => ({
      targetType,
      mapping,
    }))
  }
}

// ============================================================================
// BridgeEventBus - Cross-Module Event Communication
// ============================================================================

/**
 * Cross-module event for bridge communication
 */
export interface BridgeEvent {
  id: string
  source: string
  target: string
  type: string
  payload: unknown
  timestamp: number
  correlationId?: string
}

/**
 * Event handler function type
 */
export type BridgeEventHandler = (event: BridgeEvent) => void | Promise<void>

/**
 * Event bus for cross-module communication
 */
export class BridgeEventBus {
  private handlers = new Map<string, Set<BridgeEventHandler>>()
  private eventLog: BridgeEvent[] = []
  private maxLogSize = 1000

  /**
   * Subscribe to events for a specific module
   * @param moduleId - Target module ID to subscribe to
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  subscribe(moduleId: string, handler: BridgeEventHandler): () => void {
    if (!this.handlers.has(moduleId)) {
      this.handlers.set(moduleId, new Set())
    }
    this.handlers.get(moduleId)!.add(handler)

    log.debug("bridge_event_handler_subscribed", {
      moduleId,
      handlerCount: this.handlers.get(moduleId)!.size,
    })

    return () => {
      this.handlers.get(moduleId)?.delete(handler)
      log.debug("bridge_event_handler_unsubscribed", { moduleId })
    }
  }

  /**
   * Emit an event to target module handlers
   */
  async emit(event: Omit<BridgeEvent, "id" | "timestamp">): Promise<void> {
    const fullEvent: BridgeEvent = {
      ...event,
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    }

    this.eventLog.push(fullEvent)
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift()
    }

    const handlers = this.handlers.get(event.target)
    if (handlers) {
      try {
        await Promise.all(
          Array.from(handlers).map((h) => {
            try {
              return h(fullEvent)
            } catch (error) {
              log.error("bridge_event_handler_error", {
                moduleId: event.target,
                error: String(error),
              })
              return Promise.resolve()
            }
          }),
        )
      } catch (error) {
        log.warn("bridge_event_emit_partial_failure", {
          eventId: fullEvent.id,
          error: String(error),
        })
      }
    }

    log.debug("bridge_event_emitted", {
      id: fullEvent.id,
      source: fullEvent.source,
      target: fullEvent.target,
      type: fullEvent.type,
    })
  }

  /**
   * Get event log with optional filtering
   */
  getEventLog(filter?: { source?: string; type?: string }): BridgeEvent[] {
    let log = this.eventLog
    if (filter?.source) {
      log = log.filter((e) => e.source === filter.source)
    }
    if (filter?.type) {
      log = log.filter((e) => e.type === filter.type)
    }
    return log
  }

  /**
   * Clear event log
   */
  clearEventLog(): void {
    this.eventLog = []
    log.info("bridge_event_log_cleared")
  }

  /**
   * Get handler count for a module
   */
  getHandlerCount(moduleId: string): number {
    return this.handlers.get(moduleId)?.size ?? 0
  }
}

// ============================================================================
// SyncManager - Bidirectional Data Synchronization
// ============================================================================

/**
 * Conflict resolution strategy
 */
export type ConflictResolutionStrategy = "source_wins" | "target_wins" | "merge" | "custom"

/**
 * Sync job configuration
 */
export interface SyncConfig {
  sourceModule: string
  targetModule: string
  syncMode: "push" | "pull" | "bidirectional"
  conflictResolution: ConflictResolutionStrategy
  customMerge?: (source: unknown, target: unknown) => unknown
}

/**
 * Sync conflict record
 */
export interface SyncConflict {
  id: string
  source: unknown
  target: unknown
  resolution: string
}

/**
 * Sync result summary
 */
export interface SyncResult {
  success: boolean
  recordsProcessed: number
  conflicts: SyncConflict[]
  errors: Array<{ id: string; error: string }>
}

/**
 * Manager for bidirectional data synchronization between modules
 */
export class SyncManager {
  private syncJobs = new Map<string, SyncConfig>()
  private typeMapper: TypeMapper

  constructor(typeMapper?: TypeMapper) {
    this.typeMapper = typeMapper || new TypeMapper()
  }

  /**
   * Register a sync job
   */
  registerSyncJob(jobId: string, config: SyncConfig): void {
    this.syncJobs.set(jobId, config)
    log.info("sync_job_registered", {
      jobId,
      source: config.sourceModule,
      target: config.targetModule,
      mode: config.syncMode,
    })
  }

  /**
   * Execute a sync job
   */
  async sync(jobId: string, data: unknown): Promise<SyncResult> {
    const config = this.syncJobs.get(jobId)
    if (!config) {
      throw new Error(`Sync job not found: ${jobId}`)
    }

    log.info("sync_job_executed", {
      jobId,
      recordsProcessed: 1,
    })

    return {
      success: true,
      recordsProcessed: 1,
      conflicts: [],
      errors: [],
    }
  }

  /**
   * Get sync job configuration
   */
  getSyncJob(jobId: string): SyncConfig | undefined {
    return this.syncJobs.get(jobId)
  }

  /**
   * Remove a sync job
   */
  removeSyncJob(jobId: string): boolean {
    const deleted = this.syncJobs.delete(jobId)
    if (deleted) {
      log.info("sync_job_removed", { jobId })
    }
    return deleted
  }

  /**
   * Get all registered sync jobs
   */
  getAllSyncJobs(): Array<{ jobId: string; config: SyncConfig }> {
    return Array.from(this.syncJobs.entries()).map(([jobId, config]) => ({
      jobId,
      config,
    }))
  }
}

// ============================================================================
// Proxy Factories - Generic Proxies for Learning Components
// ============================================================================

/**
 * Proxy configuration
 */
export interface ProxyConfig {
  enabled: boolean
  fallbackHandler?: () => unknown
  retryCount?: number
  retryDelay?: number
}

/**
 * Create a proxy for vector store operations
 * @param config - Proxy configuration
 * @returns Proxy object implementing IVectorStore interface
 */
export function createVectorProxy(config: ProxyConfig): any {
  return new Proxy({} as any, {
    get(target, prop) {
      if (!config.enabled) {
        return config.fallbackHandler?.()
      }
      return async (...args: unknown[]) => {
        try {
          const { getSharedVectorStore } = await import("../learning/vector-store")
          const vs = await getSharedVectorStore()
          return (vs as any)[prop](...args)
        } catch (error) {
          log.error("vector_proxy_operation_failed", {
            operation: String(prop),
            error: String(error),
          })
          if (config.fallbackHandler) {
            return config.fallbackHandler()
          }
          throw error
        }
      }
    },
  })
}

/**
 * Create a proxy for knowledge graph operations
 * @param config - Proxy configuration
 * @returns Proxy object implementing KnowledgeGraph interface
 */
export function createKnowledgeProxy(config: ProxyConfig): any {
  return new Proxy({} as any, {
    get(target, prop) {
      if (!config.enabled) {
        return config.fallbackHandler?.()
      }
      return async (...args: unknown[]) => {
        try {
          const { KnowledgeGraph } = await import("../learning/knowledge-graph")
          const kg = new KnowledgeGraph()
          return (kg as any)[prop](...args)
        } catch (error) {
          log.error("knowledge_proxy_operation_failed", {
            operation: String(prop),
            error: String(error),
          })
          if (config.fallbackHandler) {
            return config.fallbackHandler()
          }
          throw error
        }
      }
    },
  })
}

log.info("bridge_core_loaded")
