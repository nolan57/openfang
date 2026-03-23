import { watch, type FSWatcher } from "fs"
import { existsSync, mkdirSync } from "fs"
import { join } from "path"
import { ConfigLoader } from "./config-loader"
import type { CommandConfig } from "./primitives"

export type ConfigChangeCallback = (commands: CommandConfig[], changedFile?: string) => void

export class HotReloader {
  private watcher: FSWatcher | null = null
  private configLoader: ConfigLoader
  private callbacks: ConfigChangeCallback[] = []
  private debounceTimer: NodeJS.Timeout | null = null
  private debounceMs = 500

  constructor(configLoader?: ConfigLoader) {
    this.configLoader = configLoader || new ConfigLoader()
  }

  async start(onChange?: ConfigChangeCallback): Promise<void> {
    if (onChange) {
      this.callbacks.push(onChange)
    }

    const configDir = this.configLoader.getConfigDir()

    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
      console.log(`[HotReloader] Created config directory: ${configDir}`)
    }

    await this.reload()

    this.watcher = watch(configDir, { persistent: true }, (eventType, filename) => {
      if (filename && filename.endsWith(".json")) {
        this.handleFileChange(eventType, filename)
      }
    })

    console.log(`[HotReloader] Watching for config changes in: ${configDir}`)
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    console.log("[HotReloader] Stopped")
  }

  async reload(): Promise<CommandConfig[]> {
    const commands = await this.configLoader.load()
    this.notifyCallbacks(commands)
    return commands
  }

  private handleFileChange(eventType: string, filename: string) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(async () => {
      console.log(`[HotReloader] Detected change: ${eventType} - ${filename}`)
      await this.reload()
    }, this.debounceMs)
  }

  private notifyCallbacks(commands: CommandConfig[]) {
    for (const callback of this.callbacks) {
      try {
        callback(commands)
      } catch (error) {
        console.error("[HotReloader] Callback error:", error)
      }
    }
  }

  onConfigChange(callback: ConfigChangeCallback) {
    this.callbacks.push(callback)
  }

  removeCallback(callback: ConfigChangeCallback) {
    const index = this.callbacks.indexOf(callback)
    if (index > -1) {
      this.callbacks.splice(index, 1)
    }
  }

  isWatching(): boolean {
    return this.watcher !== null
  }
}
