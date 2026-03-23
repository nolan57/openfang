export * from "./primitives"
export * from "./registry"
export * from "./config-loader"
export * from "./hot-reloader"

import { ConfigLoader } from "./config-loader"
import { HotReloader } from "./hot-reloader"
import { primitiveRegistry, type ExecutionContext } from "./registry"
import type { CommandConfig, PrimitiveAction } from "./primitives"

export class ConfigInterpreter {
  private loader: ConfigLoader
  private reloader: HotReloader
  private commands: Map<string, CommandConfig> = new Map()
  private storyState: any = {}
  private chapterNumber: number = 1
  private variables: Map<string, any> = new Map()

  constructor(configDir?: string) {
    this.loader = new ConfigLoader(configDir)
    this.reloader = new HotReloader(this.loader)
  }

  async load(): Promise<void> {
    const loadedCommands = await this.loader.load()
    for (const cmd of loadedCommands) {
      this.commands.set(cmd.name, cmd)
    }
    console.log(`[ConfigInterpreter] Loaded ${this.commands.size} commands`)
  }

  async startHotReload(): Promise<void> {
    await this.reloader.start((commands) => {
      this.commands.clear()
      for (const cmd of commands) {
        this.commands.set(cmd.name, cmd)
      }
      console.log(`[ConfigInterpreter] Hot reloaded: ${this.commands.size} commands`)
    })
  }

  stopHotReload(): void {
    this.reloader.stop()
  }

  setStoryState(state: any): void {
    this.storyState = state
  }

  setChapterNumber(num: number): void {
    this.chapterNumber = num
  }

  async executeCommand(name: string, params?: Record<string, any>): Promise<any> {
    const command = this.commands.get(name)
    if (!command) {
      throw new Error(`Command not found: ${name}`)
    }

    const context: ExecutionContext = {
      storyState: this.storyState,
      chapterNumber: this.chapterNumber,
      variables: this.variables,
    }

    return primitiveRegistry.execute(command.action, context)
  }

  async executeAction(action: PrimitiveAction, params?: Record<string, any>): Promise<any> {
    const context: ExecutionContext = {
      storyState: this.storyState,
      chapterNumber: this.chapterNumber,
      variables: this.variables,
    }

    return primitiveRegistry.execute(action, context)
  }

  getCommand(name: string): CommandConfig | undefined {
    return this.commands.get(name)
  }

  listCommands(): string[] {
    return Array.from(this.commands.keys())
  }

  getAvailablePrimitives(): string[] {
    return primitiveRegistry.listExecutors()
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name)
  }
}
