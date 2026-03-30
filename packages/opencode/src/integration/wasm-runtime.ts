/**
 * OpenFang WASM Runtime
 *
 * This module provides WASM-based integration with OpenFang for low-latency operations.
 * Currently a stub implementation - full WASM support requires building OpenFang runtime as WASM.
 *
 * Future implementation steps:
 * 1. Build openfang-runtime crate with wasm32-unknown-unknown target
 * 2. Use wasm-pack to generate JavaScript bindings
 * 3. Implement WASM memory management
 * 4. Add bidirectional communication between WASM and JS
 */

import type { Task, TaskResult } from "../collab/types"

export interface OpenFangWasmConfig {
  modulePath?: string
  memoryLimit?: number
  enableStreaming?: boolean
}

export interface WasmKernelHandle {
  boot(): Promise<void>
  spawnAgent(manifest: any): Promise<string>
  executeToolCall(agentId: string, toolName: string, params: any): Promise<any>
  terminate(): Promise<void>
}

/**
 * WASM Runtime for OpenFang integration
 *
 * Provides ultra-low latency task execution (<50ms) by running OpenFang runtime directly in the browser/Node.js
 * without network overhead. Suitable for simple, high-frequency operations.
 */
export class OpenFangWasmRuntime {
  private kernel: WasmKernelHandle | null = null
  private config: OpenFangWasmConfig
  private initialized = false
  private wasmModule: WebAssembly.Module | null = null

  constructor(config: OpenFangWasmConfig = {}) {
    this.config = {
      modulePath: config.modulePath || "@openfang/wasm",
      memoryLimit: config.memoryLimit || 64, // 64MB default
      enableStreaming: config.enableStreaming ?? true,
    }
  }

  /**
   * Initialize WASM runtime
   *
   * Note: Currently a stub. Full implementation requires:
   * - Building OpenFang with `cargo build --target wasm32-unknown-unknown`
   * - Generating JS bindings with wasm-pack
   * - Loading WASM module dynamically
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      console.log("[OpenFang WASM] Initializing runtime...")

      // TODO: Load WASM module
      // const wasmModule = await WebAssembly.instantiateStreaming(
      //   fetch(this.config.modulePath!),
      //   { /* imports */ }
      // )

      // TODO: Create kernel instance
      // this.kernel = new WasmKernel(wasmModule.instance)

      // TODO: Boot kernel
      // await this.kernel.boot()

      // Stub implementation - simulate initialization
      await new Promise((resolve) => setTimeout(resolve, 100))

      this.initialized = true
      console.log("[OpenFang WASM] Runtime initialized")
    } catch (error) {
      console.error("[OpenFang WASM] Initialization failed:", error)
      throw new Error(
        `WASM runtime initialization failed. Ensure OpenFang WASM module is built and available. ${error}`,
      )
    }
  }

  /**
   * Dispatch task to WASM runtime
   *
   * For simple tasks: <50ms latency (no network)
   * For complex tasks: Falls back to service layer
   */
  async dispatch(task: Task): Promise<string> {
    if (!this.initialized) {
      throw new Error("WASM runtime not initialized. Call initialize() first.")
    }

    // Check if task is suitable for WASM execution
    if (!this.isSuitableForWasm(task)) {
      console.log("[OpenFang WASM] Task not suitable for WASM, recommend service layer")
      throw new Error("Task requires full OpenFang service capabilities")
    }

    try {
      // TODO: Execute via WASM kernel
      // const agentId = await this.kernel!.executeTask(task)

      // Stub implementation
      const agentId = `wasm-agent-${Date.now()}`
      console.log(`[OpenFang WASM] Task dispatched: ${agentId}`)

      return agentId
    } catch (error) {
      console.error("[OpenFang WASM] Task execution failed:", error)
      throw error
    }
  }

  /**
   * Check if task is suitable for WASM execution
   *
   * WASM is best for:
   * - Simple operations (<300ms)
   * - No external API calls
   * - No file system access
   * - No subprocess execution
   */
  private isSuitableForWasm(task: Task): boolean {
    // Check complexity
    const complexity = this.estimateComplexity(task)
    if (complexity > 0.3) {
      return false
    }

    // Check requirements - WASM has limited capabilities
    const wasmCapabilities = [
      "memory_store",
      "memory_recall",
      "web_search", // via JS bridge
    ]

    if (task.requirements && task.requirements.length > 0) {
      const hasUnsupported = task.requirements.some((req) => !wasmCapabilities.some((cap) => req.includes(cap)))
      if (hasUnsupported) {
        return false
      }
    }

    // Check action keywords that require full service
    const serviceOnlyActions = ["shell", "file_write", "browser", "vault", "schedule"]
    const actionLower = task.action.toLowerCase()
    if (serviceOnlyActions.some((keyword) => actionLower.includes(keyword))) {
      return false
    }

    return true
  }

  private estimateComplexity(task: Task): number {
    let complexity = 0.1

    if (task.action.includes("search") || task.action.includes("fetch")) {
      complexity += 0.2
    }

    if (task.action.includes("write") || task.action.includes("create")) {
      complexity += 0.3
    }

    if (task.payload && typeof task.payload === "object") {
      complexity += Object.keys(task.payload).length * 0.05
    }

    return Math.min(complexity, 1.0)
  }

  /**
   * Get WASM runtime health
   */
  async health(): Promise<{ status: string; available: boolean; memory?: number }> {
    if (!this.initialized) {
      return { status: "uninitialized", available: false }
    }

    try {
      // TODO: Get actual WASM memory usage
      // const memory = this.kernel!.getMemoryUsage()

      return {
        status: "healthy",
        available: true,
        memory: this.config.memoryLimit,
      }
    } catch (error) {
      return {
        status: "unhealthy",
        available: false,
      }
    }
  }

  /**
   * Terminate WASM runtime and free resources
   */
  async terminate(): Promise<void> {
    if (!this.initialized) {
      return
    }

    try {
      // TODO: Terminate WASM kernel
      // await this.kernel!.terminate()

      this.initialized = false
      this.kernel = null
      console.log("[OpenFang WASM] Runtime terminated")
    } catch (error) {
      console.error("[OpenFang WASM] Termination failed:", error)
    }
  }
}

/**
 * Build instructions for OpenFang WASM module
 *
 * To build the WASM runtime:
 *
 * ```bash
 * # Install wasm-pack
 * cargo install wasm-pack
 *
 * # Build OpenFang runtime as WASM
 * cd openfang/crates/openfang-runtime
 * wasm-pack build --target bundler --out-dir ../pkg/wasm
 *
 * # The generated module will be in crates/pkg/wasm/
 * # Import in TypeScript:
 * import init, { OpenFangKernel } from "@openfang/wasm"
 * ```
 *
 * Build configuration (openfang/crates/openfang-runtime/Cargo.toml):
 *
 * ```toml
 * [lib]
 * crate-type = ["cdylib", "rlib"]
 *
 * [target.'cfg(target_arch = "wasm32")'.dependencies]
 * wasm-bindgen = "0.2"
 * wasm-bindgen-futures = "0.4"
 * console_error_panic_hook = "0.1"
 *
 * [profile.release]
 * opt-level = "z"
 * lto = true
 * ```
 */
export const WASM_BUILD_INSTRUCTIONS = {
  requirements: ["Rust nightly toolchain", "wasm-pack", "wasm32-unknown-unknown target"],
  steps: [
    "Install wasm-pack: cargo install wasm-pack",
    "Add WASM target: rustup target add wasm32-unknown-unknown",
    "Build: wasm-pack build --target bundler",
    "Import generated module in TypeScript",
  ],
  limitations: [
    "No direct file system access",
    "No subprocess execution",
    "Limited networking (requires JS bridge)",
    "Memory constrained (typically <128MB)",
  ],
  useCases: ["Simple task dispatch (<50ms)", "Memory operations", "Basic capability execution", "Offline mode support"],
}

/**
 * Create WASM runtime instance
 */
export function createWasmRuntime(config?: OpenFangWasmConfig): OpenFangWasmRuntime {
  return new OpenFangWasmRuntime(config)
}
