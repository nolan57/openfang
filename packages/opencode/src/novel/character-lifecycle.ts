import { z } from "zod"
import { Log } from "../util/log"

const log = Log.create({ service: "character-lifecycle" })

export const CharacterLifeStageSchema = z.enum([
  "infant",
  "child",
  "adolescent",
  "young_adult",
  "adult",
  "middle_aged",
  "elder",
  "ancient",
])

export const CharacterStatusSchema = z.enum([
  "active",
  "inactive",
  "missing",
  "imprisoned",
  "transformed",
  "dead",
  "ascended",
  "reincarnated",
])

export const LifeEventSchema = z.object({
  id: z.string(),
  type: z.enum([
    "birth",
    "coming_of_age",
    "marriage",
    "parenthood",
    "career_change",
    "trauma",
    "transformation",
    "death",
    "resurrection",
  ]),
  chapter: z.number(),
  description: z.string(),
  impact: z
    .object({
      stress: z.number().optional(),
      skills: z.array(z.string()).optional(),
      relationships: z.record(z.string(), z.number()).optional(),
      status: CharacterStatusSchema.optional(),
      trauma: z
        .object({
          name: z.string(),
          severity: z.number().min(1).max(10),
          tags: z.array(z.string()).optional(),
        })
        .optional(),
      skillGained: z
        .object({
          name: z.string(),
          category: z.string(),
          level: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
})

export const CharacterLifecycleSchema = z.object({
  characterId: z.string(),
  birthChapter: z.number(),
  deathChapter: z.number().optional(),
  currentAge: z.number(),
  lifeStage: CharacterLifeStageSchema,
  status: CharacterStatusSchema,
  agingRate: z.number().default(1.0),
  lifeEvents: z.array(LifeEventSchema),
  transformations: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      chapter: z.number(),
      reason: z.string(),
    }),
  ),
  legacy: z
    .object({
      children: z.array(z.string()).optional(),
      achievements: z.array(z.string()).optional(),
      reputation: z.number().min(-100).max(100).optional(),
    })
    .optional(),
})

export type CharacterLifeStage = z.infer<typeof CharacterLifeStageSchema>
export type CharacterStatus = z.infer<typeof CharacterStatusSchema>
export type LifeEvent = z.infer<typeof LifeEventSchema>
export type CharacterLifecycle = z.infer<typeof CharacterLifecycleSchema>

export interface LifecycleConfig {
  chaptersPerYear: number
  enableAging: boolean
  enableDeath: boolean
  enableTransformation: boolean
  maxNaturalLifespan: number
}

const DEFAULT_CONFIG: LifecycleConfig = {
  chaptersPerYear: 10,
  enableAging: true,
  enableDeath: true,
  enableTransformation: true,
  maxNaturalLifespan: 100,
}

export class CharacterLifecycleManager {
  private lifecycles: Map<string, CharacterLifecycle> = new Map()
  private config: LifecycleConfig
  private currentChapter: number = 1

  constructor(config: Partial<LifecycleConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  setCurrentChapter(chapter: number): void {
    this.currentChapter = chapter
  }

  registerCharacter(
    characterId: string,
    birthChapter: number,
    initialAge: number = 0,
    lifeStage?: CharacterLifeStage,
  ): CharacterLifecycle {
    const stage = lifeStage || this.calculateLifeStage(initialAge)

    const lifecycle: CharacterLifecycle = {
      characterId,
      birthChapter,
      currentAge: initialAge,
      lifeStage: stage,
      status: "active",
      agingRate: 1.0,
      lifeEvents: [
        {
          id: `event_birth_${characterId}`,
          type: "birth",
          chapter: birthChapter,
          description: `${characterId} was born`,
        },
      ],
      transformations: [],
      legacy: {},
    }

    this.lifecycles.set(characterId, lifecycle)
    log.info("character_registered", { characterId, birthChapter, initialAge, stage })

    return lifecycle
  }

  advanceTime(chapters: number): Array<{ characterId: string; changes: string[] }> {
    if (!this.config.enableAging) return []

    const changes: Array<{ characterId: string; changes: string[] }> = []

    for (const [characterId, lifecycle] of this.lifecycles) {
      const charChanges: string[] = []

      if (lifecycle.status === "dead" || lifecycle.status === "ascended") {
        continue
      }

      // Calculate aging
      const yearsPassed = chapters / this.config.chaptersPerYear
      const ageIncrease = yearsPassed * lifecycle.agingRate
      const newAge = lifecycle.currentAge + ageIncrease

      // Check for life stage transition
      const oldStage = lifecycle.lifeStage
      const newStage = this.calculateLifeStage(newAge)

      if (oldStage !== newStage) {
        lifecycle.lifeStage = newStage
        charChanges.push(`Aged from ${oldStage} to ${newStage}`)

        // Add coming of age event if applicable
        if (newStage === "young_adult") {
          this.addLifeEvent(characterId, {
            type: "coming_of_age",
            chapter: this.currentChapter,
            description: `${characterId} came of age`,
          })
          charChanges.push("Came of age")
        }
      }

      lifecycle.currentAge = newAge

      // Check for natural death
      if (this.config.enableDeath && lifecycle.currentAge >= this.config.maxNaturalLifespan) {
        const will = Math.random()
        if (will > 0.7) {
          // 30% chance of natural death at max age
          this.recordDeath(characterId, "natural causes")
          charChanges.push("Died of natural causes")
        }
      }

      if (charChanges.length > 0) {
        changes.push({ characterId, changes: charChanges })
        this.lifecycles.set(characterId, lifecycle)
      }
    }

    return changes
  }

  addLifeEvent(characterId: string, event: Omit<LifeEvent, "id">): LifeEvent {
    const lifecycle = this.lifecycles.get(characterId)
    if (!lifecycle) {
      throw new Error(`Character ${characterId} not found`)
    }

    const lifeEvent: LifeEvent = {
      ...event,
      id: `event_${event.type}_${characterId}_${Date.now()}`,
    }

    lifecycle.lifeEvents.push(lifeEvent)

    // Apply event impacts
    if (event.impact) {
      if (event.impact.status) {
        lifecycle.status = event.impact.status
      }
    }

    // Special handling for certain events
    if (event.type === "death") {
      this.recordDeath(characterId, event.description)
    } else if (event.type === "transformation") {
      if (event.impact?.status) {
        lifecycle.transformations.push({
          from: lifecycle.status,
          to: event.impact.status,
          chapter: event.chapter,
          reason: event.description,
        })
      }
    }

    this.lifecycles.set(characterId, lifecycle)
    log.info("life_event_added", { characterId, type: event.type, chapter: event.chapter })

    return lifeEvent
  }

  recordDeath(characterId: string, cause: string): boolean {
    const lifecycle = this.lifecycles.get(characterId)
    if (!lifecycle || lifecycle.status === "dead") return false

    lifecycle.deathChapter = this.currentChapter
    lifecycle.status = "dead"

    this.addLifeEvent(characterId, {
      type: "death",
      chapter: this.currentChapter,
      description: `${characterId} died: ${cause}`,
    })

    this.lifecycles.set(characterId, lifecycle)
    log.info("character_died", { characterId, cause, chapter: this.currentChapter })

    return true
  }

  recordTransformation(
    characterId: string,
    fromStatus: CharacterStatus,
    toStatus: CharacterStatus,
    reason: string,
  ): boolean {
    if (!this.config.enableTransformation) return false

    const lifecycle = this.lifecycles.get(characterId)
    if (!lifecycle) return false

    lifecycle.status = toStatus
    lifecycle.transformations.push({
      from: fromStatus,
      to: toStatus,
      chapter: this.currentChapter,
      reason,
    })

    this.addLifeEvent(characterId, {
      type: "transformation",
      chapter: this.currentChapter,
      description: `${characterId} transformed: ${reason}`,
      impact: { status: toStatus },
    })

    this.lifecycles.set(characterId, lifecycle)
    log.info("character_transformed", { characterId, fromStatus, toStatus })

    return true
  }

  recordResurrection(characterId: string, method: string): boolean {
    const lifecycle = this.lifecycles.get(characterId)
    if (!lifecycle || lifecycle.status !== "dead") return false

    lifecycle.status = "active"
    lifecycle.deathChapter = undefined

    this.addLifeEvent(characterId, {
      type: "resurrection",
      chapter: this.currentChapter,
      description: `${characterId} was resurrected: ${method}`,
      impact: { status: "active" },
    })

    this.lifecycles.set(characterId, lifecycle)
    log.info("character_resurrected", { characterId, method })

    return true
  }

  recordLegacy(
    characterId: string,
    legacy: {
      children?: string[]
      achievements?: string[]
      reputation?: number
    },
  ): boolean {
    const lifecycle = this.lifecycles.get(characterId)
    if (!lifecycle) return false

    lifecycle.legacy = {
      ...lifecycle.legacy,
      ...legacy,
    }

    this.lifecycles.set(characterId, lifecycle)
    log.info("legacy_recorded", { characterId })

    return true
  }

  getLifecycle(characterId: string): CharacterLifecycle | undefined {
    return this.lifecycles.get(characterId)
  }

  getActiveCharacters(): CharacterLifecycle[] {
    return Array.from(this.lifecycles.values()).filter((lc) => lc.status === "active")
  }

  getDeceasedCharacters(): CharacterLifecycle[] {
    return Array.from(this.lifecycles.values()).filter((lc) => lc.status === "dead")
  }

  getCharactersByLifeStage(stage: CharacterLifeStage): CharacterLifecycle[] {
    return Array.from(this.lifecycles.values()).filter((lc) => lc.lifeStage === stage && lc.status === "active")
  }

  getCharactersByStatus(status: CharacterStatus): CharacterLifecycle[] {
    return Array.from(this.lifecycles.values()).filter((lc) => lc.status === status)
  }

  getLifeEvents(characterId: string): LifeEvent[] {
    const lifecycle = this.lifecycles.get(characterId)
    return lifecycle?.lifeEvents || []
  }

  calculateLifeStage(age: number): CharacterLifeStage {
    if (age < 3) return "infant"
    if (age < 12) return "child"
    if (age < 18) return "adolescent"
    if (age < 25) return "young_adult"
    if (age < 50) return "adult"
    if (age < 70) return "middle_aged"
    if (age < 100) return "elder"
    return "ancient"
  }

  generateNewCharacter(context: { plotNeed?: string; existingCharacters?: string[]; currentSetting?: string }): {
    characterId: string
    lifecycle: CharacterLifecycle
    rationale: string
  } {
    const characterId = `char_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const age = Math.floor(Math.random() * 60) + 10
    const lifeStage = this.calculateLifeStage(age)

    const lifecycle = this.registerCharacter(characterId, this.currentChapter, age, lifeStage)

    const rationale = `Generated new character ${characterId} (${lifeStage}, age ${age.toFixed(0)})`

    log.info("new_character_generated", { characterId, age, lifeStage, context: context.plotNeed })

    return { characterId, lifecycle, rationale }
  }

  getLifecycleReport(): string {
    const lines: string[] = ["# Character Lifecycle Report\n"]

    const active = this.getActiveCharacters()
    const deceased = this.getDeceasedCharacters()

    lines.push(`## Active Characters (${active.length})`)
    for (const lc of active.sort((a, b) => a.currentAge - b.currentAge)) {
      lines.push(`- **${lc.characterId}** (${lc.lifeStage}, age ${lc.currentAge.toFixed(0)})`)
      lines.push(`  - Status: ${lc.status}`)
      lines.push(`  - Events: ${lc.lifeEvents.length}`)
      if (lc.transformations.length > 0) {
        lines.push(`  - Transformations: ${lc.transformations.length}`)
      }
    }

    if (deceased.length > 0) {
      lines.push(`\n## Deceased Characters (${deceased.length})`)
      for (const lc of deceased) {
        lines.push(`- **${lc.characterId}** (died Ch.${lc.deathChapter})`)
        const deathEvent = lc.lifeEvents.find((e) => e.type === "death")
        if (deathEvent) {
          lines.push(`  - Cause: ${deathEvent.description}`)
        }
      }
    }

    return lines.join("\n")
  }

  exportToJson(): { config: LifecycleConfig; lifecycles: CharacterLifecycle[] } {
    return {
      config: this.config,
      lifecycles: Array.from(this.lifecycles.values()),
    }
  }

  importFromJson(data: { config: LifecycleConfig; lifecycles: CharacterLifecycle[] }): void {
    this.config = { ...this.config, ...data.config }
    for (const lifecycle of data.lifecycles) {
      this.lifecycles.set(lifecycle.characterId, lifecycle)
    }
    log.info("lifecycles_imported", { count: data.lifecycles.length })
  }

  clear(): void {
    this.lifecycles.clear()
    log.info("character_lifecycle_cleared")
  }
}

export const characterLifecycleManager = new CharacterLifecycleManager()
