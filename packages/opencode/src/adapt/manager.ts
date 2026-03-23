/**
 * Bridge Manager - Coordinates All Module Bridges
 *
 * Manages the lifecycle and configuration of all bridge instances:
 * - Memory-Learning Bridge
 * - Evolution-Learning Bridge
 * - Novel-Learning Bridge (existing)
 *
 * @example
 * ```typescript
 * import { BridgeManager } from "./adapt"
 *
 * const manager = new BridgeManager()
 * await manager.initialize()
 *
 * // Get specific bridges
 * const memoryBridge = manager.getMemoryBridge()
 * const evolutionBridge = manager.getEvolutionBridge()
 * const novelBridge = manager.getNovelBridge()
 *
 * // Check status
 * const status = manager.getStatus()
 * ```
 */

import { Log } from "../util/log"
import { TypeMapper, BridgeEventBus, SyncManager } from "./bridge-core"
import {
  MemoryLearningBridge,
  type MemoryLearningBridgeConfig,
  DEFAULT_MEMORY_BRIDGE_CONFIG,
} from "./memory-learning-bridge"
import {
  EvolutionLearningBridge,
  type EvolutionLearningBridgeConfig,
  DEFAULT_EVOLUTION_BRIDGE_CONFIG,
} from "./evolution-learning-bridge"

const log = Log.create({ service: "bridge-manager" })

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Bridge manager configuration
 */
export interface BridgeManagerConfig {
  enabled: boolean
  memory: Partial<MemoryLearningBridgeConfig>
  evolution: Partial<EvolutionLearningBridgeConfig>
  eventBus: {
    enabled: boolean
    maxLogSize: number
  }
  syncManager: {
    enabled: boolean
  }
}

export const DEFAULT_BRIDGE_MANAGER_CONFIG: BridgeManagerConfig = {
  enabled: true,
  memory: DEFAULT_MEMORY_BRIDGE_CONFIG,
  evolution: DEFAULT_EVOLUTION_BRIDGE_CONFIG,
  eventBus: {
    enabled: true,
    maxLogSize: 1000,
  },
  syncManager: {
    enabled: true,
  },
}

/**
 * Bridge manager status
 */
export interface BridgeManagerStatus {
  enabled: boolean
  initialized: boolean
  bridges: {
    memory: {
      initialized: boolean
      vectorStore: boolean
      knowledgeGraph: boolean
    }
    evolution: {
      initialized: boolean
      vectorStore: boolean
      knowledgeGraph: boolean
    }
  }
  eventBus: {
    handlerCount: number
    eventLogSize: number
  }
  syncJobs: number
}

// ============================================================================
// BridgeManager
// ============================================================================

export class BridgeManager {
  private typeMapper: TypeMapper
  private eventBus: BridgeEventBus
  private syncManager: SyncManager
  private memoryBridge: MemoryLearningBridge | null = null
  private evolutionBridge: EvolutionLearningBridge | null = null
  private config: BridgeManagerConfig
  private initialized: boolean = false

  constructor(config: Partial<BridgeManagerConfig> = {}) {
    this.config = { ...DEFAULT_BRIDGE_MANAGER_CONFIG, ...config }

    // Initialize core components
    this.typeMapper = new TypeMapper()
    this.eventBus = new BridgeEventBus()
    this.syncManager = new SyncManager(this.typeMapper)
  }

  /**
   * Initialize all bridges
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled || this.initialized) return

    try {
      // Initialize memory bridge
      this.memoryBridge = new MemoryLearningBridge(this.typeMapper, this.eventBus, this.syncManager, this.config.memory)
      await this.memoryBridge.initialize()

      // Initialize evolution bridge
      this.evolutionBridge = new EvolutionLearningBridge(
        this.typeMapper,
        this.eventBus,
        this.syncManager,
        this.config.evolution,
      )
      await this.evolutionBridge.initialize()

      // Register event handlers
      if (this.config.eventBus.enabled) {
        this.registerEventHandlers()
      }

      this.initialized = true
      log.info("bridge_manager_initialized", {
        memory: this.memoryBridge?.getStatus().initialized,
        evolution: this.evolutionBridge?.getStatus().initialized,
      })
    } catch (error) {
      log.error("bridge_manager_init_failed", { error: String(error) })
      throw error
    }
  }

  /**
   * Register event handlers for cross-bridge communication
   */
  private registerEventHandlers(): void {
    // Memory → Evolution event forwarding
    this.eventBus.subscribe("evolution", async (event) => {
      if (event.type === "memory_added" && this.evolutionBridge) {
        log.debug("forwarding_memory_to_evolution", { eventId: event.id })
      }
    })

    // Evolution → Memory event forwarding
    this.eventBus.subscribe("memory", async (event) => {
      if (event.type === "skill_evolved" && this.memoryBridge) {
        log.debug("forwarding_evolution_to_memory", { eventId: event.id })
      }
    })

    log.info("bridge_event_handlers_registered")
  }

  /**
   * Get memory learning bridge
   */
  getMemoryBridge(): MemoryLearningBridge | null {
    return this.memoryBridge
  }

  /**
   * Get evolution learning bridge
   */
  getEvolutionBridge(): EvolutionLearningBridge | null {
    return this.evolutionBridge
  }

  /**
   * Get shared type mapper
   */
  getTypeMapper(): TypeMapper {
    return this.typeMapper
  }

  /**
   * Get shared event bus
   */
  getEventBus(): BridgeEventBus {
    return this.eventBus
  }

  /**
   * Get shared sync manager
   */
  getSyncManager(): SyncManager {
    return this.syncManager
  }

  /**
   * Get manager status
   */
  getStatus(): BridgeManagerStatus {
    const memoryStatus = this.memoryBridge?.getStatus()
    const evolutionStatus = this.evolutionBridge?.getStatus()

    return {
      enabled: this.config.enabled,
      initialized: this.initialized,
      bridges: {
        memory: {
          initialized: memoryStatus?.initialized ?? false,
          vectorStore: memoryStatus?.vectorStore ?? false,
          knowledgeGraph: memoryStatus?.knowledgeGraph ?? false,
        },
        evolution: {
          initialized: evolutionStatus?.initialized ?? false,
          vectorStore: evolutionStatus?.vectorStore ?? false,
          knowledgeGraph: evolutionStatus?.knowledgeGraph ?? false,
        },
      },
      eventBus: {
        handlerCount: this.eventBus.getHandlerCount("memory") + this.eventBus.getHandlerCount("evolution"),
        eventLogSize: this.eventBus.getEventLog().length,
      },
      syncJobs: this.syncManager.getAllSyncJobs().length,
    }
  }

  /**
   * Update configuration and reinitialize if needed
   */
  async updateConfig(newConfig: Partial<BridgeManagerConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig }

    if (this.initialized) {
      await this.close()
      await this.initialize()
    }

    log.info("bridge_manager_config_updated")
  }

  /**
   * Close all bridges and release resources
   */
  async close(): Promise<void> {
    if (this.memoryBridge) {
      await this.memoryBridge.close()
      this.memoryBridge = null
    }

    if (this.evolutionBridge) {
      await this.evolutionBridge.close()
      this.evolutionBridge = null
    }

    this.eventBus.clearEventLog()
    this.initialized = false

    log.info("bridge_manager_closed")
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let bridgeManagerInstance: BridgeManager | null = null

/**
 * Get singleton bridge manager instance
 */
export function getBridgeManager(config?: Partial<BridgeManagerConfig>): BridgeManager {
  if (!bridgeManagerInstance) {
    bridgeManagerInstance = new BridgeManager(config)
  }
  return bridgeManagerInstance
}

/**
 * Initialize singleton bridge manager
 */
export async function initBridgeManager(config?: Partial<BridgeManagerConfig>): Promise<BridgeManager> {
  const manager = getBridgeManager(config)
  await manager.initialize()
  return manager
}

log.info("bridge_manager_loaded")
