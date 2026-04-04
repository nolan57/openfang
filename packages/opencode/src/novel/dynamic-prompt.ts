import { Log } from "../util/log"
import type { PromptStyle } from "./novel-config"

const log = Log.create({ service: "dynamic-prompt" })

export interface MetaLearner {
  getSuggestedPromptStyle(): Partial<PromptStyle>
}

/**
 * 故事基调配置
 */
export interface StoryTone {
  genre: string
  mood: string
  pacing: "slow" | "medium" | "fast"
  contentRating: "general" | "teen" | "mature"
  themes: string[]
  style: string
}

/**
 * 提示词模板
 */
export interface PromptTemplate {
  id: string
  baseTemplate: string
  variables: string[]
  toneInstructions?: Partial<Record<keyof StoryTone, string>>
}

/**
 * 动态提示词构建器
 */
export class DynamicPromptBuilder {
  private baseTemplate: string
  private tone?: StoryTone
  private style: PromptStyle
  private customVariables: Record<string, string> = {}
  private metaLearner?: MetaLearner

  constructor(
    baseTemplate: string,
    style: PromptStyle = {
      verbosity: "balanced",
      creativity: 0.7,
      structureStrictness: 0.5,
      allowDeviation: true,
    },
    metaLearner?: MetaLearner,
  ) {
    this.baseTemplate = baseTemplate
    this.style = style
    this.metaLearner = metaLearner
  }

  /**
   * 设置故事基调
   */
  withTone(tone: StoryTone): DynamicPromptBuilder {
    this.tone = tone
    log.debug("prompt_builder_tone_set", {
      genre: tone.genre,
      mood: tone.mood,
    })
    return this
  }

  /**
   * 设置自定义变量
   */
  withVariables(variables: Record<string, string>): DynamicPromptBuilder {
    this.customVariables = { ...this.customVariables, ...variables }
    return this
  }

  /**
   * 生成基调相关的指令
   */
  private generateToneInstructions(): string {
    if (!this.tone) return ""

    const instructions: string[] = []

    // Genre 相关指令
    if (this.tone.genre) {
      instructions.push(
        `This is a ${this.tone.genre} story. ` + `Consider genre-appropriate elements, tropes, and expectations.`,
      )
    }

    // Mood 相关指令
    if (this.tone.mood) {
      instructions.push(`The overall mood is ${this.tone.mood}. ` + `Match the emotional tone in your responses.`)
    }

    // Pacing 相关指令
    if (this.tone.pacing) {
      const pacingInstructions = {
        slow: "Take time to develop scenes with detailed descriptions and internal reflection.",
        medium: "Balance action with character development and description.",
        fast: "Keep scenes moving with quick transitions and emphasis on action.",
      }
      instructions.push(pacingInstructions[this.tone.pacing])
    }

    // Content rating 相关指令
    if (this.tone.contentRating) {
      const ratingInstructions = {
        general: "Keep content appropriate for all ages. Avoid violence, strong language, and adult themes.",
        teen: "Moderate violence and language allowed. No explicit adult content.",
        mature: "Adult content is acceptable when narratively appropriate.",
      }
      instructions.push(ratingInstructions[this.tone.contentRating])
    }

    // Themes 相关指令
    if (this.tone.themes && this.tone.themes.length > 0) {
      instructions.push(
        `Key themes to explore: ${this.tone.themes.join(", ")}. ` +
          `Look for opportunities to weave these themes into the narrative.`,
      )
    }

    // Style 相关指令
    if (this.tone.style) {
      instructions.push(`Writing style: ${this.tone.style}. Match this style in generated content.`)
    }

    return `\n## Story Tone and Context\n${instructions.join("\n")}`
  }

  /**
   * 生成风格相关的指令
   */
  private generateStyleInstructions(): string {
    const instructions: string[] = []

    // Verbosity
    const verbosityInstructions = {
      concise: "Be concise and direct. Avoid unnecessary elaboration.",
      balanced: "Provide balanced detail - enough for clarity without excess.",
      detailed: "Be thorough and descriptive. Include rich details and nuance.",
    }
    instructions.push(verbosityInstructions[this.style.verbosity])

    // Creativity
    if (this.style.creativity >= 0.8) {
      instructions.push("Be highly creative and unexpected. Surprise the reader.")
    } else if (this.style.creativity <= 0.4) {
      instructions.push("Stick to conventional and expected narrative patterns.")
    } else {
      instructions.push("Balance creativity with narrative coherence.")
    }

    // Structure strictness
    if (this.style.structureStrictness >= 0.7) {
      instructions.push("Follow the specified format strictly.")
    } else if (this.style.structureStrictness <= 0.4) {
      instructions.push("Feel free to adapt the format as needed for the narrative.")
    }

    // Deviation
    if (this.style.allowDeviation) {
      instructions.push("You have creative freedom to deviate from expectations when narratively appropriate.")
    }

    return `\n## Response Style\n${instructions.join("\n")}`
  }

  /**
   * 替换模板变量
   */
  private substituteVariables(template: string): string {
    let result = template

    const builtInVars: Record<string, string> = {
      TONE_INSTRUCTIONS: this.generateToneInstructions(),
      STYLE_INSTRUCTIONS: this.generateStyleInstructions(),
      SKILL_DICTIONARY: this.customVariables.SKILL_DICTIONARY || "",
      TRAUMA_DICTIONARY: this.customVariables.TRAUMA_DICTIONARY || "",
    }

    for (const [key, value] of Object.entries(builtInVars)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value)
    }

    for (const [key, value] of Object.entries(this.customVariables)) {
      if (!builtInVars[key]) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value)
      }
    }

    return result
  }

  /**
   * 构建最终提示词
   */
  build(): string {
    if (this.metaLearner) {
      const suggestedStyle = this.metaLearner.getSuggestedPromptStyle()
      this.style = { ...this.style, ...suggestedStyle }
    }

    const prompt = this.substituteVariables(this.baseTemplate)
    log.debug("prompt_built", {
      templateLength: this.baseTemplate.length,
      finalLength: prompt.length,
      hasTone: !!this.tone,
      style: this.style.verbosity,
    })
    return prompt
  }

  /**
   * 构建并记录
   */
  buildWithMetadata(): { prompt: string; metadata: Record<string, unknown> } {
    return {
      prompt: this.build(),
      metadata: {
        tone: this.tone,
        style: this.style,
        variables: this.customVariables,
        builtAt: Date.now(),
      },
    }
  }
}

/**
 * 预定义的提示词模板
 */
export const PROMPT_TEMPLATES: Record<string, PromptTemplate> = {
  stateEvaluation: {
    id: "stateEvaluation",
    baseTemplate: `You are a strict game master (GM) responsible for extracting state changes from story text.

Character State Rules:
- Skill Award: A character can only receive a new skill when they successfully overcome a specific and challenging obstacle. Skills represent learned competence through adversity.
- Trauma Trigger: A character receives trauma when experiencing life-threatening events, extreme pressure (witnessing death, betrayal), or cumulative stress exceeds critical threshold.

{{TONE_INSTRUCTIONS}}
{{STYLE_INSTRUCTIONS}}

Your task:
Analyze the story segment below. Identify ALL skill awards and trauma triggers following the rules above.

Output Format (strict JSON):
{
  "skill_awards": [
    {
      "character_name": "Character name from the story",
      "skill_name": "Descriptive name for the new skill",
      "skill_category": "General category",
      "reason_in_story": "What happened in the story that warrants this skill"
    }
  ],
  "trauma_awards": [
    {
      "character_name": "Character name from the story",
      "trauma_name": "Descriptive name for the trauma",
      "trauma_tags": ["General tags"],
      "severity": 1-10,
      "reason_in_story": "What happened in the story that caused this trauma"
    }
  ]
}

Story Segment:
{{STORY_SEGMENT}}

Output only JSON, no other text.`,
    variables: ["STORY_SEGMENT"],
  },

  chaosEvent: {
    id: "chaosEvent",
    baseTemplate: `You are a creative storyteller with complete narrative freedom.

Based on the abstract chaos dimensions below, decide WHAT SPECIFICALLY happens in the story.

## Chaos Dimensions
- **Impact Direction**: {{IMPACT}}
  - positive: Something beneficial occurs
  - negative: Something harmful occurs
  - neutral: Something neither clearly good nor bad occurs

- **Change Magnitude**: {{MAGNITUDE}}
  - static: Minimal change, status quo maintained
  - minor: Small but noticeable change
  - major: Significant change that alters the situation

{{TONE_INSTRUCTIONS}}
{{STYLE_INSTRUCTIONS}}

## Current Story Context
{{STORY_CONTEXT}}

## Characters
{{CHARACTERS}}

## Recent Events
{{RECENT_EVENTS}}

{{PLOT_HOOK}}

## Your Task
Decide what SPECIFICALLY happens. Be creative and unexpected while staying true to the story.

Output ONLY the event description (2-4 sentences). No other text.`,
    variables: ["IMPACT", "MAGNITUDE", "STORY_CONTEXT", "CHARACTERS", "RECENT_EVENTS", "PLOT_HOOK"],
  },

  characterAnalysis: {
    id: "characterAnalysis",
    baseTemplate: `You are a character psychology expert. Your task is to analyze the character based on their current state data using psychological frameworks.

{{TONE_INSTRUCTIONS}}
{{STYLE_INSTRUCTIONS}}

Character State:
{{CHARACTER_STATE}}

Analyze using:
1. Big Five Personality (Openness, Conscientiousness, Extraversion, Agreeableness, Neuroticism)
2. Attachment Theory (Secure, Anxious, Avoidant, Disorganized)
3. Character Arc Phase (Denial → Resistance → Exploration → Integration → Mastery)

Output Format (strict JSON):
{
  "bigFive": {
    "openness": 0-1,
    "conscientiousness": 0-1,
    "extraversion": 0-1,
    "agreeableness": 0-1,
    "neuroticism": 0-1
  },
  "attachmentStyle": "secure|anxious|avoidant|disorganized",
  "arcPhase": "denial|resistance|exploration|integration|mastery",
  "insights": ["Key psychological insights"]
}

Output only JSON, no other text.`,
    variables: ["CHARACTER_STATE"],
  },

  branchGeneration: {
    id: "branchGeneration",
    baseTemplate: `You are a master storyteller creating narrative branches.

{{TONE_INSTRUCTIONS}}
{{STYLE_INSTRUCTIONS}}

Current Story State:
{{CURRENT_STATE}}

Key Characters:
{{CHARACTERS}}

Active Plot Threads:
{{PLOT_THREADS}}

Generate {{BRANCH_COUNT}} distinct story branches. Each branch should:
1. Present a meaningful choice or event
2. Lead to different narrative outcomes
3. Stay consistent with character motivations
4. Maintain story tone and themes

Output Format (JSON):
{
  "branches": [
    {
      "choice": "The choice or event",
      "rationale": "Why this choice matters",
      "anticipatedOutcome": "Expected narrative direction"
    }
  ]
}

Output only JSON, no other text.`,
    variables: ["BRANCH_COUNT", "CURRENT_STATE", "CHARACTERS", "PLOT_THREADS"],
  },

  psychologicalDeepening: {
    id: "psychologicalDeepening",
    baseTemplate: `You are a character psychology expert. Your task is to analyze the character based on their current state data using psychological frameworks.

{{TONE_INSTRUCTIONS}}
{{STYLE_INSTRUCTIONS}}

=== Character Data ===
{{CHARACTER_STATE}}

{{SKILL_DICTIONARY}}
{{TRAUMA_DICTIONARY}}

=== Analysis Requirements ===
Use the following psychological frameworks for analysis:

1. **Big Five Personality** - Infer from traits, skills, behavior
2. **Attachment Theory** - Infer from relationships and trauma
3. **Trauma Psychology** - Infer psychological impact from trauma and stress
4. **Maslow's Hierarchy** - Infer core desires from goals
5. **Defense Mechanisms** - Infer common defense patterns from behavior

=== Output Format (strict JSON) ===
{
  "psychologicalProfile": {
    "bigFiveTraits": {
      "openness": 1-10,
      "conscientiousness": 1-10,
      "extraversion": 1-10,
      "agreeableness": 1-10,
      "neuroticism": 1-10
    },
    "attachmentStyle": "secure|anxious|avoidant|disorganized",
    "coreFear": "One sentence describing character's deepest fear",
    "coreDesire": "One sentence describing character's core desire",
    "defenseMechanisms": ["mechanism1", "mechanism2"],
    "copingStrategies": ["strategy1", "strategy2"]
  },
  "characterArc": {
    "currentPhase": "denial|resistance|exploration|integration|mastery",
    "arcDirection": "growth|decline|complex|stagnation",
    "potentialBreakthrough": "Character's potential breakthrough point",
    "potentialBreakdown": "Character's potential breakdown point"
  },
  "relationshipDynamics": {
    "otherCharacter": {
      "dynamicType": "ally|rival|mentor|protégé|enemy|unknown",
      "powerBalance": "dominant|submissive|equal|shifting",
      "tension": "cooperating|conflicting|neutral|betrayal_risk"
    }
  },
  "narrativeSuggestions": {
    "internalConflict": "Character's core internal conflict",
    "externalConflict": "Character's external conflict",
    "growthOpportunities": ["growth opportunity 1", "growth opportunity 2"],
    "sceneTriggers": ["scene that triggers specific response 1", "scene 2"]
  },
  "suggestedEnhancements": {
    "newTraits": ["suggested new trait 1"],
    "newGoals": ["suggested new goal 1"],
    "backstoryFragments": ["suggested backstory fragment 1"],
    "dialogueTraits": ["suggested dialogue style 1"]
  }
}

Note:
- Output JSON only, no other text
- All numbers must be 1-10
- If insufficient data, use "insufficient_data" with reasonable defaults
- Use the World Knowledge Dictionary to understand skill/trauma meanings`,
    variables: ["CHARACTER_STATE", "SKILL_DICTIONARY", "TRAUMA_DICTIONARY"],
  },
}

/**
 * 创建提示词构建器的工厂函数
 */
export function createPromptBuilder(templateId: string, style?: PromptStyle): DynamicPromptBuilder {
  const template = PROMPT_TEMPLATES[templateId]
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`)
  }

  log.info("prompt_builder_created", { templateId })
  return new DynamicPromptBuilder(template.baseTemplate, style)
}
