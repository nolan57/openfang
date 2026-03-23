import type {
  PrimitiveAction,
  UpdateCharacterTrait,
  InjectPlotTwist,
  UpdateWorldState,
  GenerateChapter,
  ExtractPatterns,
  SetStoryVariable,
  ConditionalBranch,
} from "./primitives"

export type PrimitiveExecutor = (params: any, context: ExecutionContext) => Promise<any>

export interface ExecutionContext {
  storyState: any
  chapterNumber: number
  variables: Map<string, any>
}

export class PrimitiveRegistry {
  private executors: Map<string, PrimitiveExecutor> = new Map()

  constructor() {
    this.registerBuiltins()
  }

  private registerBuiltins() {
    this.register("update_character_trait", this.updateCharacterTrait.bind(this))
    this.register("inject_plot_twist", this.injectPlotTwist.bind(this))
    this.register("update_world_state", this.updateWorldState.bind(this))
    this.register("generate_chapter", this.generateChapter.bind(this))
    this.register("extract_patterns", this.extractPatterns.bind(this))
    this.register("set_story_variable", this.setStoryVariable.bind(this))
    this.register("conditional", this.executeConditional.bind(this))
  }

  register(name: string, executor: PrimitiveExecutor) {
    this.executors.set(name, executor)
  }

  async execute(action: PrimitiveAction, context: ExecutionContext): Promise<any> {
    const executor = this.executors.get(action.type)
    if (!executor) {
      throw new Error(`Unknown primitive action: ${action.type}`)
    }
    return executor(action.params, context)
  }

  hasExecutor(type: string): boolean {
    return this.executors.has(type)
  }

  listExecutors(): string[] {
    return Array.from(this.executors.keys())
  }

  private async updateCharacterTrait(params: UpdateCharacterTrait["params"], context: ExecutionContext) {
    const { character, trait, value } = params
    if (!context.storyState.characters) {
      context.storyState.characters = {}
    }
    if (!context.storyState.characters[character]) {
      context.storyState.characters[character] = { name: character }
    }
    context.storyState.characters[character][trait] = value
    console.log(`[Primitive] Updated ${character}.${trait} = ${value}`)
    return { success: true, character, trait, value }
  }

  private async injectPlotTwist(params: InjectPlotTwist["params"], context: ExecutionContext) {
    const { twist, chapter, intensity = "medium" } = params
    if (!context.storyState.plotTwists) {
      context.storyState.plotTwists = []
    }
    context.storyState.plotTwists.push({
      twist,
      chapter: chapter || context.chapterNumber,
      intensity,
      timestamp: Date.now(),
    })
    console.log(`[Primitive] Injected plot twist: ${twist.substring(0, 50)}...`)
    return { success: true, twist }
  }

  private async updateWorldState(params: UpdateWorldState["params"], context: ExecutionContext) {
    const { key, value, scope = "global" } = params
    if (!context.storyState.world) {
      context.storyState.world = {}
    }
    if (!context.storyState.world[scope]) {
      context.storyState.world[scope] = {}
    }
    context.storyState.world[scope][key] = value
    console.log(`[Primitive] Updated world.${scope}.${key}`)
    return { success: true, key, value, scope }
  }

  private async generateChapter(params: GenerateChapter["params"], context: ExecutionContext) {
    console.log(`[Primitive] Generate chapter: ${params.prompt.substring(0, 50)}...`)
    return {
      success: true,
      chapter: context.chapterNumber,
      prompt: params.prompt,
    }
  }

  private async extractPatterns(params: ExtractPatterns["params"], context: ExecutionContext) {
    console.log(`[Primitive] Extract patterns from: ${params.from}`)
    const keywords = params.from.split(/\s+/).slice(0, 10)
    return {
      success: true,
      keywords,
      extracted: keywords.length,
    }
  }

  private async setStoryVariable(params: SetStoryVariable["params"], context: ExecutionContext) {
    const { key, value } = params
    context.variables.set(key, value)
    console.log(`[Primitive] Set variable: ${key}`)
    return { success: true, key, value }
  }

  private async executeConditional(params: ConditionalBranch["params"], context: ExecutionContext) {
    const result = context.variables.get(params.condition) || false
    const actions = result ? params.then : params.else || []
    const results = []
    for (const action of actions) {
      results.push(await this.execute(action, context))
    }
    return { executed: actions.length, results }
  }
}

export const primitiveRegistry = new PrimitiveRegistry()
