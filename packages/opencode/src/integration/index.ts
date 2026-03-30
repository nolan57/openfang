/**
 * OpenFang Integration for OpenCode
 *
 * This module provides hybrid architecture integration between OpenFang (Rust-based Agent OS)
 * and OpenCode's multi-agent collaboration system.
 *
 * Architecture:
 * - Service Layer: OpenFang runs as a standalone service (production-ready)
 * - WASM Layer: Optional WASM module for ultra-low-latency operations (<50ms)
 * - Hybrid Adapter: Intelligent routing based on task complexity
 *
 * @packageDocumentation
 */

export * from "./types"
export * from "./client"
export * from "./capability-mapper"
export * from "./error-handler"
export * from "./hands"
export * from "./wasm-runtime"
export * from "./hybrid-adapter"

// Re-export the HTTP client as OpenFangClient for consistency
export { OpenFangHttpClient as OpenFangClient } from "./client"
