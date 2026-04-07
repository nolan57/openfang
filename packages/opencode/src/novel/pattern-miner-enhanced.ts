import { z } from "zod"
import { Log } from "../util/log"
import { callLLM, callLLMJson } from "./llm-wrapper"
import { getSkillsPath } from "./novel-config"
import { Skill } from "../skill/skill"
import { BaseRepository } from "./db/base-repository"
import { mkdir, writeFile } from "fs/promises"
import { resolve } from "path"

const log = Log.create({ service: "pattern-miner-enhanced" })

// ... (Keep all existing Schema definitions here) ...

// ============================================================================
// UNIFIED PATTERN REPOSITORY LAYER
// ============================================================================

class PatternRepo extends BaseRepository<any> {
  constructor() {
    super("patterns", "patterns", ["metadata", "traits", "examples"])
  }
  async initDb() {
    await this.init(`
      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY, name TEXT, category TEXT, description TEXT,
        strength REAL, decay_rate REAL, last_reinforced INTEGER,
        occurrences INTEGER, cross_story_valid INTEGER, metadata TEXT
      )
    `)
  }
  async loadAllPatterns() {
    const rows = await this.selectAll()
    return rows.map(r => ({...r, lastReinforced: r.last_reinforced, crossStoryValid: !!r.cross_story_valid, metadata: r.metadata || {}, decayRate: r.decay_rate}))
  }
  async saveAllPatterns(patterns: any[]) {
    const rows = patterns.map(p => ({...p, last_reinforced: p.lastReinforced, cross_story_valid: p.crossStoryValid ? 1 : 0, metadata: JSON.stringify(p.metadata || {}), decay_rate: p.decayRate}))
    await this.upsertMany(rows)
  }
}

class ArchetypeRepo extends BaseRepository<any> {
  constructor() {
    super("patterns", "archetypes", ["traits", "examples"])
  }
  async initDb() {
    await this.init(`
      CREATE TABLE IF NOT EXISTS archetypes (
        id TEXT PRIMARY KEY, name TEXT, type TEXT, description TEXT,
        traits TEXT, narrative_role TEXT, examples TEXT,
        strength REAL, decay_rate REAL, last_reinforced INTEGER, occurrences INTEGER
      )
    `)
  }
  async loadAllArchetypes() {
    const rows = await this.selectAll()
    return rows.map(r => ({...r, narrativeRole: r.narrative_role, lastReinforced: r.last_reinforced, decayRate: r.decay_rate, traits: JSON.parse(r.traits || "[]"), examples: JSON.parse(r.examples || "[]")}))
  }
  async saveAllArchetypes(archetypes: any[]) {
    const rows = archetypes.map(a => ({...a, narrative_role: a.narrativeRole, last_reinforced: a.lastReinforced, decay_rate: a.decayRate, traits: JSON.stringify(a.traits), examples: JSON.stringify(a.examples || [])}))
    await this.upsertMany(rows)
  }
}

class PlotTemplateRepo extends BaseRepository<any> {
  constructor() {
    super("patterns", "plot_templates", ["stages", "theme_compatibility"])
  }
  async initDb() {
    await this.init(`
      CREATE TABLE IF NOT EXISTS plot_templates (
        id TEXT PRIMARY KEY, name TEXT, structure TEXT, stages TEXT,
        theme_compatibility TEXT, flexibility REAL, usage_count INTEGER, last_used INTEGER
      )
    `)
  }
  async loadAllTemplates() {
    const rows = await this.selectAll()
    return rows.map(r => ({...r, themeCompatibility: JSON.parse(r.theme_compatibility || "[]"), usageCount: r.usage_count, lastUsed: r.last_used}))
  }
  async saveAllTemplates(templates: any[]) {
    const rows = templates.map(t => ({...t, theme_compatibility: JSON.stringify(t.themeCompatibility || []), usage_count: t.usageCount, last_used: t.lastUsed || Date.now()}))
    await this.upsertMany(rows)
  }
}

class MotifDataRepo extends BaseRepository<any> {
  constructor() {
    super("patterns", "motifs", ["occurrences", "evolution"])
  }
  async initDb() {
    await this.init(`
      CREATE TABLE IF NOT EXISTS motifs (
        id TEXT PRIMARY KEY, name TEXT, type TEXT, description TEXT,
        occurrences TEXT, evolution TEXT, strength REAL, decay_rate REAL
      )
    `)
  }
  async loadAllMotifs() {
    const rows = await this.selectAll()
    return rows.map(r => ({...r, decayRate: r.decay_rate, occurrences: JSON.parse(r.occurrences || "[]"), evolution: r.evolution ? JSON.parse(r.evolution) : []}))
  }
  async saveAllMotifs(motifs: any[]) {
    const rows = motifs.map(m => ({...m, decay_rate: m.decayRate, occurrences: JSON.stringify(m.occurrences), evolution: JSON.stringify(m.evolution || [])}))
    await this.upsertMany(rows)
  }
}

const patternRepo = new PatternRepo()
const archetypeRepo = new ArchetypeRepo()
const plotTemplateRepo = new PlotTemplateRepo()
const motifDataRepo = new MotifDataRepo()

// ... (Rest of the file continues normally) ...

export const ArchetypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum([
    "hero",
    "mentor",
    "shadow",
    "trickster",
    "herald",
    "shapeshifter",
    "guardian",
    "ally",
    "temptress",
    "threshold_guardian",
  ]),
  description: z.string(),
  traits: z.array(z.string()),
  narrative_role: z.string(),
  examples: z.array(z.string()).optional(),
  strength: z.number().min(0).max(100).default(50),
  decay_rate: z.number().min(0).max(1).default(0.1),
  last_reinforced: z.number(),
  occurrences: z.number().default(1),
})

export const PlotTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  structure: z.enum([
    "three_act",
    "hero_journey",
    "save_the_cat",
    "seven_point",
    "fichtean_curve",
    "kishoutenketsu",
    "in_media_res",
  ]),
  stages: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      narrative_beats: z.array(z.string()),
    }),
  ),
  theme_compatibility: z.array(z.string()).optional(),
  flexibility: z.number().min(0).max(100).default(50),
  usage_count: z.number().default(0),
  last_used: z.number().optional(),
})

export const MotifSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum([
    "symbolic",
    "thematic",
    "imagery",
    "recurring_object",
    "recurring_phrase",
    "color",
    "number",
    "nature",
  ]),
  description: z.string(),
  occurrences: z.array(
    z.object({
      chapter: z.number(),
      context: z.string(),
      significance: z.number().min(1).max(10),
    }),
  ),
  evolution: z
    .array(
      z.object({
        from_state: z.string(),
        to_state: z.string(),
        trigger_event: z.string(),
        chapter: z.number(),
      }),
    )
    .optional(),
  strength: z.number().min(0).max(100).default(50),
  decay_rate: z.number().min(0).max(1).default(0.05),
})

export const EnhancedPatternSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum([
    "character_trait",
    "world_rule",
    "skill",
    "plot_device",
    "tone",
    "archetype",
    "plot_template",
    "motif",
  ]),
  description: z.string(),
  embedding: z.array(z.number()).optional(),
  similarity_vector: z.string().optional(),
  strength: z.number().min(0).max(100).default(50),
  decay_rate: z.number().min(0).max(1).default(0.1),
  last_reinforced: z.number(),
  occurrences: z.number().default(1),
  cross_story_valid: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type Archetype = z.infer<typeof ArchetypeSchema>
export type PlotTemplate = z.infer<typeof PlotTemplateSchema>
export type Motif = z.infer<typeof MotifSchema>
export type EnhancedPattern = z.infer<typeof EnhancedPatternSchema>

export interface PatternDecayConfig {
  baseDecayRate: number
  reinforcementBoost: number
  minStrengthThreshold: number
  crossStoryBonus: number
}

const DEFAULT_DECAY_CONFIG: PatternDecayConfig = {
  baseDecayRate: 0.1,
  reinforcementBoost: 20,
  minStrengthThreshold: 10,
  crossStoryBonus: 5,
}

export class EnhancedPatternMiner {
  private patterns: Map<string, EnhancedPattern> = new Map()
  private archetypes: Map<string, Archetype> = new Map()
  private plotTemplates: Map<string, PlotTemplate> = new Map()
  private motifs: Map<string, Motif> = new Map()
  private config: PatternDecayConfig
  private turnCount: number = 0

  constructor(config: Partial<PatternDecayConfig> = {}) {
    this.config = { ...DEFAULT_DECAY_CONFIG, ...config }
  }

  async initialize(): Promise<void> {
    await patternRepo.initDb()
    await archetypeRepo.initDb()
    await plotTemplateRepo.initDb()
    await motifDataRepo.initDb()

    const patterns = await patternRepo.loadAllPatterns()
    const archetypes = await archetypeRepo.loadAllArchetypes()
    const templates = await plotTemplateRepo.loadAllTemplates()
    const motifs = await motifDataRepo.loadAllMotifs()

    for (const p of patterns) this.patterns.set(p.id, p)
    for (const a of archetypes) this.archetypes.set(a.id, a)
    for (const t of templates) this.plotTemplates.set(t.id, t)
    for (const m of motifs) this.motifs.set(m.id, m)

    log.info("patterns_loaded_from_db", {
      patterns: this.patterns.size,
      archetypes: this.archetypes.size,
      templates: this.plotTemplates.size,
      motifs: this.motifs.size,
    })
  }

  async savePatterns(): Promise<void> {
    await patternRepo.saveAllPatterns(Array.from(this.patterns.values()))
    await archetypeRepo.saveAllArchetypes(Array.from(this.archetypes.values()))
    await plotTemplateRepo.saveAllTemplates(Array.from(this.plotTemplates.values()))
    await motifDataRepo.saveAllMotifs(Array.from(this.motifs.values()))
  }

  applyDecay(): void {
    const now = Date.now()
    const dayInMs = 24 * 60 * 60 * 1000

    for (const [id, pattern] of this.patterns) {
      const daysSinceReinforcement = (now - pattern.last_reinforced) / dayInMs
      const decayAmount = pattern.decay_rate * daysSinceReinforcement
      pattern.strength = Math.max(0, pattern.strength - decayAmount)

      if (pattern.strength < this.config.minStrengthThreshold) {
        this.patterns.delete(id)
        log.info("pattern_decayed_removed", { id, finalStrength: pattern.strength })
      }
    }

    for (const [id, archetype] of this.archetypes) {
      const daysSinceReinforcement = (now - archetype.last_reinforced) / dayInMs
      const decayAmount = archetype.decay_rate * daysSinceReinforcement
      archetype.strength = Math.max(0, archetype.strength - decayAmount)

      if (archetype.strength < this.config.minStrengthThreshold) {
        this.archetypes.delete(id)
        log.info("archetype_decayed_removed", { id, finalStrength: archetype.strength })
      }
    }

    for (const [id, motif] of this.motifs) {
      const daysSinceReinforcement =
        motif.occurrences.length > 0
          ? (now - motif.occurrences[motif.occurrences.length - 1].chapter * 1000) / dayInMs
          : 0
      const decayAmount = motif.decay_rate * daysSinceReinforcement
      motif.strength = Math.max(0, motif.strength - decayAmount)

      if (motif.strength < this.config.minStrengthThreshold && motif.occurrences.length < 3) {
        this.motifs.delete(id)
        log.info("motif_decayed_removed", { id, finalStrength: motif.strength })
      }
    }
  }

  reinforcePattern(patternId: string): void {
    const pattern = this.patterns.get(patternId)
    if (pattern) {
      pattern.strength = Math.min(100, pattern.strength + this.config.reinforcementBoost)
      pattern.last_reinforced = Date.now()
      pattern.occurrences++
      this.patterns.set(patternId, pattern)
      log.info("pattern_reinforced", { id: patternId, newStrength: pattern.strength })
    }
  }

  reinforceArchetype(archetypeId: string): void {
    const archetype = this.archetypes.get(archetypeId)
    if (archetype) {
      archetype.strength = Math.min(100, archetype.strength + this.config.reinforcementBoost)
      archetype.last_reinforced = Date.now()
      archetype.occurrences++
      this.archetypes.set(archetypeId, archetype)
      log.info("archetype_reinforced", { id: archetypeId, newStrength: archetype.strength })
    }
  }

  async extractArchetypes(
    storySegment: string,
    characters: Record<string, any>,
    chapter: number,
  ): Promise<Archetype[]> {
    const charSummary = Object.entries(characters)
      .map(([name, char]) => `${name}: ${JSON.stringify(char.traits || [])}, stress: ${char.stress || 0}`)
      .join("\n")

    const prompt = `Analyze the following story segment and character states. Identify which characters embody classic narrative archetypes.

Story Segment:
${storySegment.substring(0, 2000)}

Characters:
${charSummary}

For each character that clearly embodies an archetype, output:
{
  "characterName": "name",
  "archetypeType": "hero|mentor|shadow|trickster|herald|shapeshifter|guardian|ally|temptress|threshold_guardian",
  "description": "Why this character fits this archetype",
  "traits": ["relevant", "traits"],
  "narrativeRole": "What role they play in the story"
}

Output JSON array. If no clear archetypes, output empty array.`

    try {
      const result = await callLLMJson<
        Array<{
          characterName: string
          archetypeType: string
          description: string
          traits: string[]
          narrativeRole: string
        }>
      >({
        prompt,
        callType: "archetype_extraction",
        temperature: 0.5,
        useRetry: true,
      })
      const extracted = result.data
      const newArchetypes: Archetype[] = []

      for (const item of extracted) {
        const archetypeTypeEnum = item.archetypeType as Archetype["type"]
        const id = `archetype_${item.characterName}_${archetypeTypeEnum}`
        const existing = this.archetypes.get(id)

        if (existing) {
          this.reinforceArchetype(id)
          newArchetypes.push(existing)
        } else {
          const archetype: Archetype = {
            id,
            name: `${item.characterName} as ${archetypeTypeEnum}`,
            type: archetypeTypeEnum,
            description: item.description,
            traits: item.traits || [],
            narrative_role: item.narrativeRole,
            strength: 50,
            decay_rate: 0.1,
            last_reinforced: Date.now(),
            occurrences: 1,
          }
          this.archetypes.set(id, archetype)
          newArchetypes.push(archetype)
          log.info("archetype_extracted", { id, type: archetype.type })
        }
      }

      return newArchetypes
    } catch (error) {
      log.error("archetype_extraction_failed", { error: String(error) })
      return []
    }
  }

  async extractPlotTemplates(storySegment: string, chapter: number, fullStory: string): Promise<PlotTemplate[]> {
    const prompt = `Analyze this story segment in context of the full narrative. Identify if it follows a classic plot structure.

Previous Story Summary:
${fullStory.slice(-1000)}

Current Chapter (${chapter}):
${storySegment.substring(0, 1500)}

Identify the plot structure being used. Output:
{
  "structureType": "three_act|hero_journey|save_the_cat|seven_point|fichtean_curve|kishoutenketsu|in_media_res",
  "currentStage": "name of current stage",
  "stages": [
    {
      "name": "Stage name",
      "description": "What happens",
      "narrativeBeats": ["beat1", "beat2"]
    }
  ],
  "themeCompatibility": ["theme1", "theme2"]
}

If unclear, output a basic structure that best fits.`

    try {
      const result = await callLLMJson<{
        structureType: string
        currentStage: string
        stages: Array<{ name: string; description: string; narrativeBeats: string[] }>
        themeCompatibility: string[]
      }>({
        prompt,
        callType: "plot_template_extraction",
        temperature: 0.3,
        useRetry: true,
      })
      const extracted = result.data
      const id = `template_${extracted.structureType}_${chapter}`
      const structureEnum = extracted.structureType as PlotTemplate["structure"]

      const template: PlotTemplate = {
        id,
        name: extracted.structureType.replace(/_/g, " "),
        structure: structureEnum,
        stages: (extracted.stages || []).map((s) => ({
          name: s.name,
          description: s.description,
          narrative_beats: s.narrativeBeats || [],
        })),
        theme_compatibility: extracted.themeCompatibility,
        flexibility: 50,
        usage_count: 1,
        last_used: Date.now(),
      }

      this.plotTemplates.set(id, template)
      log.info("plot_template_extracted", { id, structure: template.structure })

      return [template]
    } catch (error) {
      log.error("plot_template_extraction_failed", { error: String(error) })
      return []
    }
  }

  async extractMotifs(storySegment: string, chapter: number): Promise<Motif[]> {
    const prompt = `Analyze this story segment for recurring motifs, symbols, or thematic elements.

Story Segment:
${storySegment.substring(0, 2000)}

Identify motifs. Output JSON array:
[
  {
    "name": "motif name",
    "type": "symbolic|thematic|imagery|recurring_object|recurring_phrase|color|number|nature",
    "description": "what this motif represents",
    "significance": 1-10,
    "context": "brief context of occurrence"
  ]

Focus on elements that could recur and evolve throughout the story.`

    try {
      const result = await callLLMJson<
        Array<{
          name: string
          type: string
          description: string
          significance: number
          context: string
        }>
      >({
        prompt,
        callType: "motif_extraction",
        temperature: 0.5,
        useRetry: true,
      })
      const extracted = result.data
      const newMotifs: Motif[] = []

      for (const item of extracted) {
        const motifTypeEnum = item.type as Motif["type"]
        const id = `motif_${item.name.toLowerCase().replace(/\s+/g, "_")}`
        const existing = this.motifs.get(id)

        if (existing) {
          existing.occurrences.push({
            chapter,
            context: item.context,
            significance: item.significance,
          })
          existing.strength = Math.min(100, existing.strength + 10)
          this.motifs.set(id, existing)
          newMotifs.push(existing)
        } else {
          const motif: Motif = {
            id,
            name: item.name,
            type: motifTypeEnum,
            description: item.description,
            occurrences: [
              {
                chapter,
                context: item.context,
                significance: item.significance,
              },
            ],
            strength: 30 + item.significance * 5,
            decay_rate: 0.05,
          }
          this.motifs.set(id, motif)
          newMotifs.push(motif)
          log.info("motif_extracted", { id, type: motif.type })
        }
      }

      return newMotifs
    } catch (error) {
      log.error("motif_extraction_failed", { error: String(error) })
      return []
    }
  }

  evolveMotif(motifId: string, newState: string, triggerEvent: string, chapter: number): void {
    const motif = this.motifs.get(motifId)
    if (!motif) return

    if (!motif.evolution) {
      motif.evolution = []
    }

    const lastState = motif.evolution.length > 0 ? motif.evolution[motif.evolution.length - 1].to_state : "initial"

    motif.evolution.push({
      from_state: lastState,
      to_state: newState,
      trigger_event: triggerEvent,
      chapter,
    })

    motif.strength = Math.min(100, motif.strength + 15)
    this.motifs.set(motifId, motif)

    log.info("motif_evolved", {
      id: motifId,
      from: lastState,
      to: newState,
      trigger: triggerEvent,
    })
  }

  getActiveArchetypes(threshold: number = 30): Archetype[] {
    return Array.from(this.archetypes.values())
      .filter((a) => a.strength >= threshold)
      .sort((a, b) => b.strength - a.strength)
  }

  getActiveMotifs(threshold: number = 30): Motif[] {
    return Array.from(this.motifs.values())
      .filter((m) => m.strength >= threshold)
      .sort((a, b) => b.strength - a.strength)
  }

  getPlotTemplates(): PlotTemplate[] {
    return Array.from(this.plotTemplates.values()).sort((a, b) => b.usage_count - a.usage_count)
  }

  getMotifEvolutionReport(): string {
    const lines: string[] = ["# Motif Evolution Report\n"]

    for (const motif of this.getActiveMotifs()) {
      lines.push(`## ${motif.name} (${motif.type})`)
      lines.push(`**Strength:** ${motif.strength.toFixed(1)}%`)
      lines.push(`**Description:** ${motif.description}`)
      lines.push(`**Occurrences:** ${motif.occurrences.length}`)

      if (motif.evolution && motif.evolution.length > 0) {
        lines.push("\n### Evolution:")
        for (const ev of motif.evolution) {
          lines.push(`- Ch.${ev.chapter}: ${ev.from_state} → ${ev.to_state}`)
          lines.push(`  Trigger: ${ev.trigger_event}`)
        }
      }

      lines.push(`\n### Occurrences:`)
      for (const occ of motif.occurrences.slice(-5)) {
        lines.push(`- Ch.${occ.chapter}: ${occ.context.slice(0, 100)}... (significance: ${occ.significance}/10)`)
      }
      lines.push("")
    }

    return lines.join("\n")
  }

  getArchetypeReport(): string {
    const lines: string[] = ["# Character Archetypes Report\n"]

    for (const archetype of this.getActiveArchetypes()) {
      lines.push(`## ${archetype.name}`)
      lines.push(`**Type:** ${archetype.type}`)
      lines.push(`**Strength:** ${archetype.strength.toFixed(1)}%`)
      lines.push(`**Occurrences:** ${archetype.occurrences}`)
      lines.push(`**Description:** ${archetype.description}`)
      lines.push(`**Traits:** ${archetype.traits.join(", ")}`)
      lines.push(`**Narrative Role:** ${archetype.narrative_role}`)
      lines.push("")
    }

    return lines.join("\n")
  }

  /**
   * Extract ALL narrative patterns (archetypes, plot templates, motifs) in a SINGLE LLM call.
   * Reduces API cost and latency by 66% compared to 3 separate calls.
   */
  async extractAllPatterns(turnData: {
    storySegment: string
    characters: Record<string, any>
    chapter: number
    fullStory: string
  }): Promise<{ archetypes: Archetype[]; templates: PlotTemplate[]; motifs: Motif[] }> {
    const charSummary = Object.entries(turnData.characters)
      .map(([name, char]) => `${name}: ${JSON.stringify(char.traits || [])}, stress: ${char.stress || 0}`)
      .join("\n")

    const prompt = `Analyze this story segment for narrative patterns. Extract Archetypes, Plot Structure, and Motifs.

Story Segment:
${turnData.storySegment.substring(0, 2000)}

Previous Story Summary:
${turnData.fullStory.slice(-1000)}

Characters:
${charSummary}

Output a SINGLE JSON object with these three keys:
{
  "archetypes": [
    {
      "characterName": "name",
      "archetypeType": "hero|mentor|shadow|trickster|herald|shapeshifter|guardian|ally|temptress|threshold_guardian",
      "description": "Why this character fits",
      "traits": ["relevant", "traits"],
      "narrativeRole": "Role in story"
    }
  ],
  "plotStructure": {
    "structureType": "three_act|hero_journey|save_the_cat|seven_point|fichtean_curve|kishoutenketsu|in_media_res",
    "currentStage": "Stage name",
    "stages": [
      { "name": "Stage", "description": "What happens", "narrativeBeats": ["beat1"] }
    ],
    "themeCompatibility": ["theme1"]
  },
  "motifs": [
    {
      "name": "motif name",
      "type": "symbolic|thematic|imagery|recurring_object|recurring_phrase|color|number|nature",
      "description": "What it represents",
      "significance": 1-10,
      "context": "Brief context"
    }
  ]
}
If none found for a category, use an empty array (or null for plotStructure).`

    try {
      const result = await callLLMJson<{
        archetypes: Array<{
          characterName: string
          archetypeType: string
          description: string
          traits: string[]
          narrativeRole: string
        }>
        plotStructure: {
          structureType: string
          currentStage: string
          stages: Array<{ name: string; description: string; narrativeBeats: string[] }>
          themeCompatibility: string[]
        } | null
        motifs: Array<{
          name: string
          type: string
          description: string
          significance: number
          context: string
        }>
      }>({
        prompt,
        callType: "combined_pattern_extraction",
        temperature: 0.5,
        useRetry: true,
      })

      const extracted = result.data
      const archetypes: Archetype[] = []
      const templates: PlotTemplate[] = []
      const motifs: Motif[] = []

      // Process Archetypes
      for (const item of extracted.archetypes || []) {
        const type = item.archetypeType as Archetype["type"]
        const id = `archetype_${item.characterName}_${type}`
        const existing = this.archetypes.get(id)
        if (existing) {
          this.reinforceArchetype(id)
          archetypes.push(existing)
        } else {
          const arch: Archetype = {
            id, name: `${item.characterName} as ${type}`, type, description: item.description,
            traits: item.traits || [], narrative_role: item.narrativeRole, strength: 50, decay_rate: 0.1,
            last_reinforced: Date.now(), occurrences: 1,
          }
          this.archetypes.set(id, arch)
          archetypes.push(arch)
        }
      }

      // Process Plot Structure
      if (extracted.plotStructure) {
        const ps = extracted.plotStructure
        const id = `template_${ps.structureType}_${turnData.chapter}`
        const template: PlotTemplate = {
          id, name: ps.structureType.replace(/_/g, " "), structure: ps.structureType as any,
          stages: (ps.stages || []).map(s => ({ name: s.name, description: s.description, narrative_beats: s.narrativeBeats || [] })),
          theme_compatibility: ps.themeCompatibility || [], flexibility: 50, usage_count: 1, last_used: Date.now(),
        }
        this.plotTemplates.set(id, template)
        templates.push(template)
      }

      // Process Motifs
      for (const item of extracted.motifs || []) {
        const type = item.type as Motif["type"]
        const id = `motif_${item.name.toLowerCase().replace(/\s+/g, "_")}`
        const existing = this.motifs.get(id)
        if (existing) {
          existing.occurrences.push({ chapter: turnData.chapter, context: item.context, significance: item.significance })
          existing.strength = Math.min(100, existing.strength + 10)
          this.motifs.set(id, existing)
          motifs.push(existing)
        } else {
          const motif: Motif = {
            id, name: item.name, type, description: item.description,
            occurrences: [{ chapter: turnData.chapter, context: item.context, significance: item.significance }],
            strength: 30 + item.significance * 5, decay_rate: 0.05,
          }
          this.motifs.set(id, motif)
          motifs.push(motif)
        }
      }

      return { archetypes, templates, motifs }
    } catch (error) {
      log.error("combined_pattern_extraction_failed", { error: String(error) })
      return { archetypes: [], templates: [], motifs: [] }
    }
  }

  async onTurn(turnData: {
    storySegment: string
    characters: Record<string, any>
    chapter: number
    fullStory: string
  }): Promise<{
    archetypes: Archetype[]
    templates: PlotTemplate[]
    motifs: Motif[]
  }> {
    this.turnCount++

    if (this.turnCount % 5 === 0) {
      this.applyDecay()
    }

    // 🚀 OPTIMIZATION: Extract all patterns in a SINGLE LLM call (66% cost reduction)
    const { archetypes, templates, motifs } = await this.extractAllPatterns(turnData)

    // Generate narrative skills if complex patterns detected
    await this.checkAndGenerateSkills(turnData.storySegment, turnData.fullStory)

    await this.savePatterns()

    return { archetypes, templates, motifs }
  }

  /**
   * Analyze story segment and generate narrative skills when complex patterns emerge.
   * Migrated from orchestrator's checkAndGenerateSkills.
   */
  private async checkAndGenerateSkills(storySegment: string, fullStory?: string): Promise<void> {
    try {
      const prompt = `Analyze this story segment and determine if a narrative skill should be generated.

Story Segment (last 500 chars):
${storySegment.slice(-500)}

Full Story Context (last 1000 chars):
${(fullStory || "").slice(-1000)}

Output JSON:
{
  "shouldGenerate": true/false,
  "trigger": "brief reason if true",
  "skillName": "camelCase skill name if true",
  "guidelines": ["guideline 1", "guideline 2", "guideline 3"],
  "examples": ["example 1", "example 2"]
}`

      const result = await callLLM({
        prompt,
        callType: "skill_generation_check",
      })

      const match = result.text.match(/\{[\s\S]*\}/)
      if (!match) return

      const decision = JSON.parse(match[0])
      if (!decision.shouldGenerate) return

      const skillContent = `# Auto-Generated Narrative Skill

Generated: ${new Date().toISOString()}

## Trigger
${decision.trigger}

## Guidelines
${(decision.guidelines || []).map((g: string) => `- ${g}`).join("\n")}

## Examples
${(decision.examples || []).map((e: string) => `- ${e}`).join("\n")}
`
      const skillsDir = resolve(getSkillsPath())
      await mkdir(skillsDir, { recursive: true })
      const fileName = `${skillsDir}/${decision.skillName || "auto"}-${Date.now()}.md`
      await writeFile(fileName, skillContent)
      await Skill.reload()
      log.info("skill_generated", { fileName })
    } catch (error) {
      log.error("skill_generation_failed", { error: String(error) })
    }
  }

  getStats(): {
    patterns: number
    archetypes: number
    templates: number
    motifs: number
    avgStrength: number
  } {
    const allPatterns = [
      ...Array.from(this.patterns.values()),
      ...Array.from(this.archetypes.values()),
      ...Array.from(this.motifs.values()),
    ]

    const avgStrength =
      allPatterns.length > 0 ? allPatterns.reduce((sum, p) => sum + p.strength, 0) / allPatterns.length : 0

    return {
      patterns: this.patterns.size,
      archetypes: this.archetypes.size,
      templates: this.plotTemplates.size,
      motifs: this.motifs.size,
      avgStrength,
    }
  }

  clear(): void {
    this.patterns.clear()
    this.archetypes.clear()
    this.plotTemplates.clear()
    this.motifs.clear()
    log.info("patterns_cleared")
  }
}

export const enhancedPatternMiner = new EnhancedPatternMiner()
