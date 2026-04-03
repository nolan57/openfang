import { z } from "zod"
import { Log } from "../util/log"
import { callLLMJson } from "./llm-wrapper"

const log = Log.create({ service: "relationship-inertia" })

export const RelationshipInertiaSchema = z.object({
  characterA: z.string(),
  characterB: z.string(),
  trustInertia: z.number().min(0).max(100).default(50),
  hostilityInertia: z.number().min(0).max(100).default(50),
  lastMajorShift: z.number().optional(),
  shiftHistory: z
    .array(
      z.object({
        from: z.number(),
        to: z.number(),
        chapter: z.number(),
        event: z.string(),
        dramatic: z.boolean(),
      }),
    )
    .optional(),
  resistanceToChange: z.number().min(0).max(100).default(50),
})

export const PlotHookSchema = z.object({
  id: z.string(),
  type: z.enum([
    "betrayal",
    "alliance",
    "rivalry_escalation",
    "reconciliation",
    "sacrifice",
    "secret_revealed",
    "forced_cooperation",
    "power_shift",
    "trust_test",
    "confession",
  ]),
  characters: z.array(z.string()).min(2),
  description: z.string(),
  triggerConditions: z.array(z.string()),
  narrativeImpact: z.string(),
  tensionPotential: z.number().min(1).max(10),
  chapterRange: z
    .object({
      min: z.number(),
      max: z.number(),
    })
    .optional(),
  triggered: z.boolean().default(false),
  triggeredChapter: z.number().optional(),
})

export type RelationshipInertia = z.infer<typeof RelationshipInertiaSchema>
export type PlotHook = z.infer<typeof PlotHookSchema>

export interface InertiaConfig {
  minShiftThreshold: number
  dramaticEventMultiplier: number
  resistanceDecayRate: number
  maxHistoryLength: number
}

const DEFAULT_CONFIG: InertiaConfig = {
  minShiftThreshold: 10,
  dramaticEventMultiplier: 3,
  resistanceDecayRate: 0.1,
  maxHistoryLength: 10,
}

export class RelationshipInertiaManager {
  private inertiaMap: Map<string, RelationshipInertia> = new Map()
  private plotHooks: Map<string, PlotHook> = new Map()
  private config: InertiaConfig

  constructor(config: Partial<InertiaConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  private getKey(charA: string, charB: string): string {
    return [charA, charB].sort().join("-")
  }

  initializeRelationship(charA: string, charB: string, initialTrust: number = 0): void {
    const key = this.getKey(charA, charB)
    if (this.inertiaMap.has(key)) return

    const inertia: RelationshipInertia = {
      characterA: charA,
      characterB: charB,
      trustInertia: initialTrust,
      hostilityInertia: 0,
      resistanceToChange: 50,
      shiftHistory: [],
    }

    this.inertiaMap.set(key, inertia)
    log.info("relationship_initialized", { characters: key, initialTrust })
  }

  calculateAllowedShift(
    charA: string,
    charB: string,
    proposedShift: number,
    isDramaticEvent: boolean,
    currentChapter: number,
  ): { allowed: boolean; actualShift: number; reason: string } {
    const key = this.getKey(charA, charB)
    const inertia = this.inertiaMap.get(key)

    if (!inertia) {
      this.initializeRelationship(charA, charB)
      return { allowed: true, actualShift: proposedShift, reason: "New relationship" }
    }

    const resistance = inertia.resistanceToChange / 100
    const maxShift = isDramaticEvent
      ? this.config.minShiftThreshold * this.config.dramaticEventMultiplier * (1 - resistance)
      : this.config.minShiftThreshold * (1 - resistance)

    if (Math.abs(proposedShift) <= maxShift) {
      return { allowed: true, actualShift: proposedShift, reason: "Within resistance threshold" }
    }

    const actualShift = Math.sign(proposedShift) * maxShift

    if (isDramaticEvent) {
      return {
        allowed: true,
        actualShift: proposedShift,
        reason: "Dramatic event overrides resistance",
      }
    }

    return {
      allowed: false,
      actualShift,
      reason: `Resistance (${inertia.resistanceToChange}) limited shift from ${proposedShift} to ${actualShift}`,
    }
  }

  applyShift(
    charA: string,
    charB: string,
    trustDelta: number,
    event: string,
    isDramatic: boolean,
    currentChapter: number,
  ): void {
    const key = this.getKey(charA, charB)
    const inertia = this.inertiaMap.get(key)

    if (!inertia) {
      this.initializeRelationship(charA, charB)
      this.applyShift(charA, charB, trustDelta, event, isDramatic, currentChapter)
      return
    }

    const { actualShift, reason } = this.calculateShift(charA, charB, trustDelta, isDramatic, currentChapter)

    const previousTrust = inertia.trustInertia
    inertia.trustInertia = Math.max(-100, Math.min(100, inertia.trustInertia + actualShift))

    if (!inertia.shiftHistory) {
      inertia.shiftHistory = []
    }

    inertia.shiftHistory.push({
      from: previousTrust,
      to: inertia.trustInertia,
      chapter: currentChapter,
      event,
      dramatic: isDramatic,
    })

    if (inertia.shiftHistory.length > this.config.maxHistoryLength) {
      inertia.shiftHistory = inertia.shiftHistory.slice(-this.config.maxHistoryLength)
    }

    inertia.lastMajorShift = Date.now()

    if (isDramatic) {
      inertia.resistanceToChange = Math.min(100, inertia.resistanceToChange + 20)
    }

    this.inertiaMap.set(key, inertia)

    log.info("relationship_shift_applied", {
      characters: key,
      from: previousTrust,
      to: inertia.trustInertia,
      delta: actualShift,
      reason,
    })
  }

  private calculateShift(
    charA: string,
    charB: string,
    proposedShift: number,
    isDramatic: boolean,
    chapter: number,
  ): { actualShift: number; reason: string } {
    const result = this.calculateAllowedShift(charA, charB, proposedShift, isDramatic, chapter)
    return { actualShift: result.actualShift, reason: result.reason }
  }

  decayResistance(): void {
    for (const [key, inertia] of this.inertiaMap) {
      inertia.resistanceToChange = Math.max(0, inertia.resistanceToChange * (1 - this.config.resistanceDecayRate))
      this.inertiaMap.set(key, inertia)
    }
  }

  getInertia(charA: string, charB: string): RelationshipInertia | undefined {
    return this.inertiaMap.get(this.getKey(charA, charB))
  }

  getAllInertias(): RelationshipInertia[] {
    return Array.from(this.inertiaMap.values())
  }

  async generatePlotHooks(
    relationships: Record<string, any>,
    characters: Record<string, any>,
    currentChapter: number,
  ): Promise<PlotHook[]> {
    const relContext = Object.entries(relationships)
      .slice(0, 10)
      .map(([key, rel]) => {
        const inertia = this.inertiaMap.get(key)
        return `${key}: trust=${rel.trust}, resistance=${inertia?.resistanceToChange || 50}`
      })
      .join("\n")

    const charContext = Object.entries(characters)
      .slice(0, 5)
      .map(([name, char]) => `${name}: stress=${char.stress || 0}, status=${char.status || "active"}`)
      .join("\n")

    const prompt = `Analyze these relationships and characters to generate narrative plot hooks.

RELATIONSHIPS:
${relContext}

CHARACTERS:
${charContext}

CURRENT CHAPTER: ${currentChapter}

Generate 3-5 character-driven plot hooks. Output JSON:
{
  "hooks": [
    {
      "type": "betrayal|alliance|rivalry_escalation|reconciliation|sacrifice|secret_revealed|forced_cooperation|power_shift|trust_test|confession",
      "characters": ["char1", "char2"],
      "description": "what happens",
      "triggerConditions": ["condition 1", "condition 2"],
      "narrativeImpact": "how this affects the story",
      "tensionPotential": 1-10,
      "suggestedChapterRange": { "min": N, "max": N }
    }
  ]
}`

    try {
      const result = await callLLMJson<{
        hooks: Array<{
          type: string
          characters: string[]
          description: string
          triggerConditions: string[]
          narrativeImpact: string
          tensionPotential: number
          suggestedChapterRange: { min: number; max: number }
        }>
      }>({
        prompt,
        callType: "plot_hook_generation",
        temperature: 0.6,
        useRetry: true,
      })

      const newHooks: PlotHook[] = []
      for (const hook of result.data.hooks || []) {
        const id = `hook_${hook.type}_${Date.now()}`
        const plotHook: PlotHook = {
          id,
          type: hook.type as any,
          characters: hook.characters,
          description: hook.description,
          triggerConditions: hook.triggerConditions || [],
          narrativeImpact: hook.narrativeImpact,
          tensionPotential: hook.tensionPotential || 5,
          chapterRange: hook.suggestedChapterRange,
          triggered: false,
        }

        this.plotHooks.set(id, plotHook)
        newHooks.push(plotHook)

        log.info("plot_hook_generated", {
          id,
          type: hook.type,
          characters: hook.characters,
        })
      }

      return newHooks
    } catch (error) {
      log.error("plot_hook_generation_failed", { error: String(error) })
      return []
    }
  }

  triggerHook(hookId: string, chapter: number): boolean {
    const hook = this.plotHooks.get(hookId)
    if (!hook || hook.triggered) return false

    hook.triggered = true
    hook.triggeredChapter = chapter
    this.plotHooks.set(hookId, hook)

    log.info("plot_hook_triggered", { id: hookId, chapter, type: hook.type })
    return true
  }

  getActiveHooks(): PlotHook[] {
    return Array.from(this.plotHooks.values()).filter((h) => !h.triggered)
  }

  getTriggeredHooks(): PlotHook[] {
    return Array.from(this.plotHooks.values()).filter((h) => h.triggered)
  }

  getHooksForCharacters(characters: string[]): PlotHook[] {
    return this.getActiveHooks().filter((h) => characters.some((c) => h.characters.includes(c)))
  }

  getPlotHooksReport(): string {
    const lines: string[] = ["# Relationship Plot Hooks Report\n"]

    const activeHooks = this.getActiveHooks()
    if (activeHooks.length > 0) {
      lines.push("## Active Plot Hooks\n")
      for (const hook of activeHooks) {
        lines.push(`### ${hook.type.replace(/_/g, " ")}: ${hook.characters.join(" & ")}`)
        lines.push(`**Description:** ${hook.description}`)
        lines.push(`**Tension:** ${hook.tensionPotential}/10`)
        lines.push(`**Impact:** ${hook.narrativeImpact}`)
        lines.push(`**Triggers:** ${hook.triggerConditions.join(", ")}`)
        if (hook.chapterRange) {
          lines.push(`**Suggested Chapters:** ${hook.chapterRange.min}-${hook.chapterRange.max}`)
        }
        lines.push("")
      }
    }

    const triggeredHooks = this.getTriggeredHooks()
    if (triggeredHooks.length > 0) {
      lines.push("## Triggered Plot Hooks\n")
      for (const hook of triggeredHooks) {
        lines.push(`- **${hook.type}** (${hook.characters.join(" & ")}): Ch.${hook.triggeredChapter}`)
        lines.push(`  ${hook.description}`)
      }
    }

    lines.push("\n## Relationship Inertia\n")
    for (const inertia of this.getAllInertias()) {
      lines.push(`### ${inertia.characterA} & ${inertia.characterB}`)
      lines.push(`- Trust: ${inertia.trustInertia}`)
      lines.push(`- Resistance: ${inertia.resistanceToChange}`)
      lines.push(`- Shifts: ${inertia.shiftHistory?.length || 0}`)
    }

    return lines.join("\n")
  }

  clear(): void {
    this.inertiaMap.clear()
    this.plotHooks.clear()
    log.info("relationship_inertia_cleared")
  }
}

export const relationshipInertiaManager = new RelationshipInertiaManager()
