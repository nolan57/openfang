import { readFile, readdir, stat } from "fs/promises"
import { resolve, join } from "path"
import { existsSync } from "fs"
import type { ConfigFile, CommandConfig } from "./primitives"

export class ConfigLoader {
  private configDir: string
  private loadedConfigs: Map<string, ConfigFile> = new Map()

  constructor(configDir?: string) {
    this.configDir = configDir || join(process.env.HOME || ".", ".opencode", "commands")
  }

  async load(): Promise<CommandConfig[]> {
    const allCommands: CommandConfig[] = []

    if (!existsSync(this.configDir)) {
      console.log(`[ConfigLoader] Config directory does not exist: ${this.configDir}`)
      return allCommands
    }

    const files = await this.discoverConfigFiles()

    for (const file of files) {
      try {
        const config = await this.loadFile(file)
        if (config && config.commands) {
          this.loadedConfigs.set(file, config)
          allCommands.push(...config.commands)
          console.log(`[ConfigLoader] Loaded ${config.commands.length} commands from ${file}`)
        }
      } catch (error) {
        console.error(`[ConfigLoader] Failed to load ${file}:`, error)
      }
    }

    return allCommands
  }

  private async discoverConfigFiles(): Promise<string[]> {
    const configFiles: string[] = []

    try {
      const entries = await readdir(this.configDir)
      for (const entry of entries) {
        if (entry.endsWith(".json")) {
          const filePath = join(this.configDir, entry)
          const fileStat = await stat(filePath)
          if (fileStat.isFile()) {
            configFiles.push(filePath)
          }
        }
      }
    } catch (error) {
      console.error(`[ConfigLoader] Error reading config directory:`, error)
    }

    return configFiles
  }

  private async loadFile(filePath: string): Promise<ConfigFile | null> {
    const content = await readFile(filePath, "utf-8")
    const parsed = JSON.parse(content)
    return parsed as ConfigFile
  }

  async loadFromPath(filePath: string): Promise<CommandConfig[]> {
    const resolvedPath = resolve(filePath)
    const config = await this.loadFile(resolvedPath)

    if (config && config.commands) {
      this.loadedConfigs.set(resolvedPath, config)
      return config.commands
    }

    return []
  }

  getLoadedConfigs(): Map<string, ConfigFile> {
    return this.loadedConfigs
  }

  getConfigDir(): string {
    return this.configDir
  }

  setConfigDir(dir: string) {
    this.configDir = dir
    this.loadedConfigs.clear()
  }
}
