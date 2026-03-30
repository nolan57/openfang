import { initHybridAdapter, getHybridAdapter, type HybridConfig } from "../integration/hybrid-adapter"
import { Log } from "../util/log"
import { Config } from "../config/config"

const log = Log.create({ service: "openfang-integration" })

let initialized = false
let initializationPromise: Promise<void> | null = null

export interface OpenFangIntegrationConfig {
  enabled: boolean
  baseUrl: string
  apiKey?: string
  autoActivateHands: string[]
}

const defaultConfig: OpenFangIntegrationConfig = {
  enabled: false,
  baseUrl: "http://localhost:4200",
  apiKey: undefined,
  autoActivateHands: [],
}

/**
 * Initialize OpenFang integration with config from opencode.json or explicit params
 */
export async function initializeOpenFangIntegration(
  config?:
    | Partial<OpenFangIntegrationConfig>
    | { enabled?: boolean; baseUrl?: string; apiKey?: string; autoActivateHands?: string[] },
): Promise<void> {
  if (initialized) {
    return
  }

  if (initializationPromise) {
    return initializationPromise
  }

  // Merge config with defaults - will read from Config.state() when available
  const configInfo = config
  const finalConfig: OpenFangIntegrationConfig = {
    enabled: configInfo?.enabled ?? defaultConfig.enabled,
    baseUrl: configInfo?.baseUrl ?? defaultConfig.baseUrl,
    apiKey: configInfo?.apiKey ?? defaultConfig.apiKey,
    autoActivateHands: configInfo?.autoActivateHands ?? defaultConfig.autoActivateHands,
  }

  if (!finalConfig.enabled) {
    log.info("OpenFang integration disabled")
    return
  }

  initializationPromise = (async () => {
    try {
      log.info("Initializing OpenFang integration", {
        baseUrl: finalConfig.baseUrl,
        hands: finalConfig.autoActivateHands,
      })

      const hybridConfig: HybridConfig = {
        openfang: {
          enabled: true,
          base_url: finalConfig.baseUrl,
          api_key: finalConfig.apiKey,
          wasm_enabled: false,
        },
      }

      const adapter = await initHybridAdapter(hybridConfig)

      // Auto-activate configured Hands
      for (const handName of finalConfig.autoActivateHands) {
        try {
          await adapter.activateHand(handName)
          log.info(`Activated OpenFang Hand: ${handName}`)
        } catch (error) {
          log.error(`Failed to activate Hand '${handName}'`, {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Health check
      const health = await adapter.health()
      log.info("OpenFang integration initialized", { status: health.status, available: health.available })

      initialized = true
    } catch (error) {
      log.error("Failed to initialize OpenFang integration", {
        error: error instanceof Error ? error.message : String(error),
      })
      initialized = false
      throw error
    } finally {
      initializationPromise = null
    }
  })()

  return initializationPromise
}

export function getOpenFangAdapter() {
  if (!initialized) {
    throw new Error("OpenFang integration not initialized. Call initializeOpenFangIntegration first.")
  }
  return getHybridAdapter()
}

export function isOpenFangInitialized(): boolean {
  return initialized
}

export async function dispatchToOpenFang(
  task: { id: string; action: string; payload?: any; requirements?: string[]; priority?: "low" | "normal" | "high" },
  strategy?: string,
): Promise<string> {
  if (!initialized) {
    throw new Error("OpenFang integration not initialized")
  }

  const adapter = getHybridAdapter()
  return adapter.dispatch(
    {
      id: task.id,
      action: task.action,
      payload: task.payload ?? {},
      requirements: task.requirements ?? [],
      priority: task.priority ?? "normal",
    },
    strategy as any,
  )
}
