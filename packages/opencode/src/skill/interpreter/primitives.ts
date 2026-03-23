export type PrimitiveAction =
  | UpdateCharacterTrait
  | InjectPlotTwist
  | RegisterCliCommand
  | UpdateWorldState
  | GenerateChapter
  | ExtractPatterns
  | SetStoryVariable
  | ConditionalBranch

export interface UpdateCharacterTrait {
  type: "update_character_trait"
  params: {
    character: string
    trait: string
    value: any
  }
}

export interface InjectPlotTwist {
  type: "inject_plot_twist"
  params: {
    twist: string
    chapter?: number
    intensity?: "low" | "medium" | "high"
  }
}

export interface RegisterCliCommand {
  type: "register_cli_command"
  params: {
    name: string
    description: string
    parameters?: Record<string, any>
  }
}

export interface UpdateWorldState {
  type: "update_world_state"
  params: {
    key: string
    value: any
    scope?: "global" | "chapter" | "session"
  }
}

export interface GenerateChapter {
  type: "generate_chapter"
  params: {
    prompt: string
    output?: string
    chapterNumber?: number
  }
}

export interface ExtractPatterns {
  type: "extract_patterns"
  params: {
    from: string
    minKeywords?: number
  }
}

export interface SetStoryVariable {
  type: "set_story_variable"
  params: {
    key: string
    value: any
  }
}

export interface ConditionalBranch {
  type: "conditional"
  params: {
    condition: string
    then: PrimitiveAction[]
    else?: PrimitiveAction[]
  }
}

export interface CommandConfig {
  name: string
  description: string
  parameters?: Record<
    string,
    {
      type: string
      required?: boolean
      default?: any
      description?: string
    }
  >
  action: PrimitiveAction
}

export interface ConfigFile {
  version: string
  commands: CommandConfig[]
  imports?: string[]
}

export function isPrimitiveAction(obj: any): obj is PrimitiveAction {
  return obj && typeof obj === "object" && typeof obj.type === "string"
}
