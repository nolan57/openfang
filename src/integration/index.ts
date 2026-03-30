/**
 * OpenFang Integration for OpenCode
 *
 * This module provides hybrid architecture integration between OpenFang (Rust-based Agent OS)
 * and OpenCode's multi-agent collaboration system.
 *
 * @packageDocumentation
 */

export * from "./types"
export * from "./client"
export * from "./capability-mapper"
export * from "./error-handler"
export * from "./hands"

// Re-export the HTTP client as OpenFangClient for consistency
export { OpenFangHttpClient as OpenFangClient } from "./client"
