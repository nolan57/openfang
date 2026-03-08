import { Log } from "../util/log"
import { generateText } from "ai"
import { getNovelLanguageModel } from "./model"

const log = Log.create({ service: "relationship-analyzer" })

export interface RelationshipState {
  trust: number // -100 to 100
  hostility: number // 0 to 100
  dominance: number // -100 to 100
  friendliness: number // -100 to 100
  dynamic?: string
  attachmentStyle?: "secure" | "anxious" | "avoidant" | "disorganized"
  history?: RelationshipHistoryEntry[]
}

export interface RelationshipHistoryEntry {
  timestamp: number
  chapter: number
  turn?: number
  previous: string
  current: string
  delta: number
}

// Faction types for group dynamics
export interface Faction {
  id: string
  name: string
  members: string[]
  core_belief: string
}

export interface InterFactionRelation {
  from: string
  to: string
  trust: number // -100 to 100
  hostility: number // 0 to 100
  dynamic: string
  narrative_hook: string
}

export interface DeepenedRelationship {
  // 关系类型推断
  dynamicType: "ally" | "rival" | "mentor" | "protégé" | "love" | "enemy" | "stranger" | "family" | "unknown"

  // 权力关系
  powerBalance: "dominant" | "submissive" | "equal" | "shifting" | "unclear"

  // 情感张力
  tension: "cooperating" | "conflicting" | "neutral" | "betrayal_risk" | "rupture" | "reconciliation"

  // 关系阶段
  stage: "formation" | "development" | "stable" | "crisis" | "transformation" | "dissolution"

  // 核心冲突
  coreConflict: string // 关系中最主要的矛盾
  sharedHistory: string // 共同的过去（推断）

  // 发展潜力
  developmentPotential: {
    direction: "closer" | "distant" | "complex" | "stagnant"
    catalysts: string[] // 能推动关系发展的事件
    obstacles: string[] // 阻碍关系发展的事件
  }

  // 叙事建议
  narrativeHooks: {
    conflictOpportunities: string[] // 可以制造冲突的场景
    bondingOpportunities: string[] // 可以加深关系的场景
    betrayalSetup: string[] // 可以埋下背叛伏笔的场景
  }
}

export interface RelationshipAnalysisResult {
  relationships: {
    [pairKey: string]: DeepenedRelationship
  }
  groupDynamics: {
    summary: string
    factions: Faction[]
    interFactionRelations: InterFactionRelation[]
  }
  narrativeSuggestions: {
    relationshipFocus: string // 建议关注哪段关系
    suggestedEvent: string // 建议的事件类型
    expectedOutcome: string // 期望的结果
  }
}

/**
 * Relationship Analyzer - 角色关系深化分析
 *
 * 分析角色之间的关系动态，生成叙事建议
 * 独立于单个角色的心理分析，专注于关系维度
 */
export class RelationshipAnalyzer {
  /**
   * 分析所有角色之间的关系
   */
  async analyzeAllRelationships(
    characters: Record<
      string,
      {
        name: string
        relationships?: Record<string, RelationshipState>
        trauma?: { name: string }[]
        skills?: { name: string }[]
      }
    >,
  ): Promise<RelationshipAnalysisResult> {
    log.info("analyzing_relationships", {
      characterCount: Object.keys(characters).length,
    })

    const languageModel = await getNovelLanguageModel()

    // 构建关系摘要
    const relationshipSummary = this.buildRelationshipSummary(characters)

    const prompt = `You are a relationship dynamics expert. Analyze the relationships between these characters.

CURRENT RELATIONSHIPS:
${relationshipSummary}

YOUR TASK:
Analyze each pair of characters and output:

1. For each relationship pair (CharacterA-CharacterB):
   - dynamicType: ally/rival/mentor/protégé/love/enemy/stranger/family/unknown
   - powerBalance: dominant/submissive/equal/shifting/unclear
   - tension: cooperating/conflicting/neutral/betrayal_risk/rupture/reconciliation
   - stage: formation/development/stable/crisis/transformation/dissolution
   - coreConflict: What is the main conflict in this relationship?
   - sharedHistory: What might their shared past be?
   - developmentPotential: { direction, catalysts, obstacles }
   - narrativeHooks: { conflictOpportunities, bondingOpportunities, betrayalSetup }

2. Group Dynamics:
   - Identify factions or groups
   - Note alliances and conflicts

3. Narrative Suggestions:
   - Which relationship should be the focus?
   - What event type would be most interesting?
   - What outcome would serve the story?

Output JSON:
{
  "relationships": {
    "CharacterA-CharacterB": { ... }
  },
  "groupDynamics": [
    { "factionName": "...", "members": [...], "alliances": [...], "conflicts": [...] }
  ],
  "narrativeSuggestions": {
    "relationshipFocus": "...",
    "suggestedEvent": "...",
    "expectedOutcome": "..."
  }
}`

    try {
      const result = await generateText({
        model: languageModel,
        prompt,
      })

      const match = result.text.match(/\{[\s\S]*\}/)
      if (match) {
        const analysis = JSON.parse(match[0])

        // Add LLM-driven group dynamics analysis
        let groupDynamicsResult = {
          summary: "No significant group dynamics detected.",
          factions: [] as Faction[],
          interFactionRelations: [] as InterFactionRelation[],
        }

        const characterNames = Object.keys(characters)
        if (characterNames.length >= 3) {
          try {
            // Build all relationships summary for group analysis
            const allRels: Record<string, RelationshipState> = {}
            for (const [name, char] of Object.entries(characters)) {
              if (char.relationships) {
                for (const [other, rel] of Object.entries(char.relationships)) {
                  allRels[`${name}-${other}`] = rel
                }
              }
            }

            const allRelsSummary = this.buildAllRelationshipsSummaryForGroups(characterNames, allRels)
            const storyContext = Object.values(characters)
              .map((c) => c.name)
              .join(", ")

            const groupResult = await this.analyzeGroupDynamicsWithLLM(characterNames, allRelsSummary, storyContext)

            if (groupResult.factions.length > 0) {
              groupDynamicsResult = {
                summary: `LLM identified ${groupResult.factions.length} narrative factions.`,
                factions: groupResult.factions,
                interFactionRelations: groupResult.interFactionRelations,
              }
            }
          } catch (error) {
            log.warn("group_dynamics_llm_integration_failed", { error: String(error) })
          }
        }

        log.info("relationships_analyzed", {
          pairCount: Object.keys(analysis.relationships || {}).length,
        })

        return {
          ...analysis,
          groupDynamics: groupDynamicsResult,
        }
      }
    } catch (e) {
      log.error("relationship_analysis_failed", { error: String(e) })
    }

    return this.createDefaultAnalysis()
  }

  /**
   * 分析单个关系的变化
   */
  async analyzeRelationshipChange(
    characterA: string,
    characterB: string,
    currentState: RelationshipState,
    recentEvent: string,
    storyContext: string,
  ): Promise<{
    newTrust: number
    newHostility: number
    newDynamic: string
    relationshipShift: "strengthened" | "weakened" | "transformed" | "stable"
    reasoning: string
  }> {
    const languageModel = await getNovelLanguageModel()

    const prompt = `Analyze how this event affects the relationship between ${characterA} and ${characterB}.

CURRENT STATE:
- Trust: ${currentState.trust} (-100 to 100)
- Hostility: ${currentState.hostility} (0 to 100)
- Dynamic: ${currentState.dynamic || "not defined"}

RECENT EVENT:
${recentEvent}

STORY CONTEXT:
${storyContext}

OUTPUT JSON:
{
  "newTrust": -100 to 100,
  "newHostility": 0 to 100,
  "newDynamic": "brief description of the relationship now",
  "relationshipShift": "strengthened|weakened|transformed|stable",
  "reasoning": "Why this change makes sense"
}`

    try {
      const result = await generateText({
        model: languageModel,
        prompt,
      })

      const match = result.text.match(/\{[\s\S]*\}/)
      if (match) {
        return JSON.parse(match[0])
      }
    } catch (e) {
      log.warn("relationship_change_analysis_failed", { error: String(e) })
    }

    // Default: no change
    return {
      newTrust: currentState.trust,
      newHostility: currentState.hostility,
      newDynamic: currentState.dynamic || "unchanged",
      relationshipShift: "stable",
      reasoning: "Analysis failed, maintaining current state",
    }
  }

  /**
   * 生成关系相关的分支选项
   */
  async generateRelationshipBranches(
    characters: Record<string, any>,
    currentFocus: string | null,
  ): Promise<{
    branchPoint: string
    options: {
      choice: string
      characters: string[] // 涉及的角色
      relationshipImpact: string
      rationale: string
    }[]
  }> {
    const languageModel = await getNovelLanguageModel()

    const relationshipSummary = this.buildRelationshipSummary(characters)

    const prompt = `Based on the current relationships, suggest 2-3 story branches that focus on relationship dynamics.

CURRENT RELATIONSHIPS:
${relationshipSummary}

${currentFocus ? `Current focus: ${currentFocus}` : ""}

Generate branches that:
- Explore relationship tension or development
- Involve multiple characters
- Create interesting narrative possibilities

Output JSON:
{
  "branchPoint": "The key relationship moment",
  "options": [
    {
      "choice": "What happens",
      "characters": ["CharacterA", "CharacterB"],
      "relationshipImpact": "How this affects the relationship",
      "rationale": "Why this is interesting"
    }
  ]
}`

    try {
      const result = await generateText({
        model: languageModel,
        prompt,
      })

      const match = result.text.match(/\{[\s\S]*\}/)
      if (match) {
        return JSON.parse(match[0])
      }
    } catch (e) {
      log.warn("relationship_branch_generation_failed", { error: String(e) })
    }

    return {
      branchPoint: "角色互动时刻",
      options: [
        {
          choice: "角色之间进行深入对话",
          characters: [],
          relationshipImpact: "加深了解",
          rationale: "促进关系发展",
        },
      ],
    }
  }

  /**
   * 构建关系摘要字符串
   */
  private buildRelationshipSummary(
    characters: Record<
      string,
      {
        name: string
        relationships?: Record<string, RelationshipState>
        trauma?: { name: string }[]
        skills?: { name: string }[]
      }
    >,
  ): string {
    const lines: string[] = []

    for (const [name, char] of Object.entries(characters)) {
      if (char.relationships) {
        for (const [other, rel] of Object.entries(char.relationships)) {
          lines.push(`${name} <-> ${other}:`)
          lines.push(`  Trust: ${rel.trust}, Hostility: ${rel.hostility || 0}`)
          if (rel.dynamic) lines.push(`  Dynamic: ${rel.dynamic}`)
          if (rel.attachmentStyle) lines.push(`  Attachment: ${rel.attachmentStyle}`)
        }
      }
    }

    return lines.join("\n") || "No relationships defined"
  }

  /**
   * Build all relationships summary for group dynamics analysis
   */
  private buildAllRelationshipsSummaryForGroups(
    characters: string[],
    allRels: Record<string, RelationshipState>,
  ): string {
    const lines: string[] = []

    for (let i = 0; i < characters.length; i++) {
      for (let j = i + 1; j < characters.length; j++) {
        const charA = characters[i]
        const charB = characters[j]
        const rel = allRels[`${charA}-${charB}`] || allRels[`${charB}-${charA}`]

        if (rel) {
          lines.push(`${charA} <-> ${charB}:`)
          lines.push(`  Trust: ${rel.trust}, Hostility: ${rel.hostility || 0}`)
          if (rel.dynamic) lines.push(`  Dynamic: ${rel.dynamic}`)
        }
      }
    }

    return lines.join("\n") || "No relationships defined"
  }

  /**
   * LLM-driven group dynamics analysis - pure AI-powered faction detection
   */
  private async analyzeGroupDynamicsWithLLM(
    characters: string[],
    allRelsSummary: string,
    storyContext: string,
  ): Promise<{ factions: Faction[]; interFactionRelations: InterFactionRelation[] }> {
    const prompt = `You are an expert narrative analyst. Your task is to identify hidden factions and analyze macro-level group dynamics.

Instructions:
1. Identify Factions: Group the characters into coherent factions based on their relationships, shared goals, or ideological alignment.
   - A faction must have at least 1 member.
   - Give each faction a thematic name and a concise "core_belief" (1 sentence).
2. Analyze Inter-Faction Relations: For EVERY pair of distinct factions, determine:
   - Trust (-100 to 100)
   - Hostility (0 to 100)
   - A dynamic label (e.g., "Cold War", "Unstable Alliance", "Ideological Rivals")
   - A compelling narrative hook for future conflict or cooperation.

Characters & Pairwise Relationships:
${allRelsSummary}

Story Context:
${storyContext.substring(0, 1500)}

Output Format:
Respond ONLY with a JSON object in this exact format:
{
  "factions": [
    { "id": "faction_1", "name": "...", "members": ["CharA", "CharB"], "core_belief": "..." }
  ],
  "interFactionRelations": [
    { "from": "faction_1", "to": "faction_2", "trust": number, "hostility": number, "dynamic": "...", "narrative_hook": "..." }
  ]
}`

    try {
      const result = await generateText({
        model: await getNovelLanguageModel(),
        prompt,
      })

      const jsonMatch = result.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        log.warn("no_json_in_group_dynamics_response")
        return { factions: [], interFactionRelations: [] }
      }

      const parsed = JSON.parse(jsonMatch[0])

      return {
        factions: Array.isArray(parsed.factions) ? parsed.factions : [],
        interFactionRelations: Array.isArray(parsed.interFactionRelations) ? parsed.interFactionRelations : [],
      }
    } catch (error) {
      log.warn("llm_group_dynamics_failed", { error: String(error) })
      return { factions: [], interFactionRelations: [] }
    }
  }

  private createDefaultAnalysis(): RelationshipAnalysisResult {
    return {
      relationships: {},
      groupDynamics: {
        summary: "No significant group dynamics detected.",
        factions: [],
        interFactionRelations: [],
      },
      narrativeSuggestions: {
        relationshipFocus: "",
        suggestedEvent: "",
        expectedOutcome: "",
      },
    }
  }
}

export const relationshipAnalyzer = new RelationshipAnalyzer()
