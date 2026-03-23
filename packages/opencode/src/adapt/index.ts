/**
 * Adapt Module - Generic Bridge Adapter Layer
 *
 * Provides reusable components for building bridges between modules:
 * - bridge-core: TypeMapper, BridgeEventBus, SyncManager
 * - memory-learning-bridge: Memory ↔ Learning integration
 * - evolution-learning-bridge: Evolution ↔ Learning integration
 * - manager: Centralized bridge lifecycle management
 *
 * @example
 * ```typescript
 * import {
 *   BridgeManager,
 *   TypeMapper,
 *   BridgeEventBus,
 *   MemoryLearningBridge,
 *   EvolutionLearningBridge
 * } from "./adapt"
 *
 * // Use centralized manager
 * const manager = new BridgeManager()
 * await manager.initialize()
 *
 * // Or use individual components
 * const memoryBridge = manager.getMemoryBridge()
 * const evolutionBridge = manager.getEvolutionBridge()
 * ```
 */

// ============================================================================
// Core Components
// ============================================================================

export {
  TypeMapper,
  BridgeEventBus,
  SyncManager,
  createVectorProxy,
  createKnowledgeProxy,
  type TypeMapping,
  type BridgeEvent,
  type BridgeEventHandler,
  type SyncConfig,
  type SyncResult,
  type SyncConflict,
  type ConflictResolutionStrategy,
  type ProxyConfig,
} from "./bridge-core"

// ============================================================================
// Memory-Learning Bridge
// ============================================================================

export {
  MemoryLearningBridge,
  DEFAULT_MEMORY_BRIDGE_CONFIG,
  MEMORY_TYPE_MAPPINGS,
  type MemoryLearningBridgeConfig,
  type MemoryServiceEntry,
  type MemoryKnowledgeNode,
} from "./memory-learning-bridge"

// ============================================================================
// Evolution-Learning Bridge
// ============================================================================

export {
  EvolutionLearningBridge,
  DEFAULT_EVOLUTION_BRIDGE_CONFIG,
  EVOLUTION_TYPE_MAPPINGS,
  type EvolutionLearningBridgeConfig,
  type EvolutionKnowledgeNode,
} from "./evolution-learning-bridge"

// ============================================================================
// Bridge Manager
// ============================================================================

export {
  BridgeManager,
  getBridgeManager,
  initBridgeManager,
  DEFAULT_BRIDGE_MANAGER_CONFIG,
  type BridgeManagerConfig,
  type BridgeManagerStatus,
} from "./manager"
