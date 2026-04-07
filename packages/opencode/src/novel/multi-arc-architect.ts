import { z } from "zod"
import { Log } from "../util/log"
import { callLLMJson } from "./llm-wrapper"
import { readFile, writeFile, mkdir, access } from "fs/promises"
import { resolve, dirname } from "path"
import { getNovelDataDir } from "./novel-config"

const log = Log.create({ service: "multi-arc-architect" })

// ============================================================================
// TYPES
// ============================================================================

export interface SagaAct {
  id: string
  title: string
  description: string
  chapterRange: { start: number; end: number }
  thematicGoal: string
  keyEvents: string[]
  chekhovsGuns: Array<{
    id: string
    description: string
    plantedChapter: number
    payoffChapter?: number
    status: "planted" | "developing" | "ready_to_payoff" | "resolved"
  }>
  midpointReversal?: string
  climax?: string
}

export interface SagaVolume {
  id: string
  title: string
  description: string
  chapterRange: { start: number; end: number }
  acts: SagaAct[]
  grandTheme: string
  majorArcResolution: string
  status: "planned" | "in_progress" | "completed" | "revised"
}

export interface ChekhovsGun {
  id: string
  description: string
  plantedChapter: number
  expectedPayoffChapter: number | null
  expectedPayoffVolume: string | null
  status: "planted" | "developing" | "ready_to_payoff" | "resolved" | "dropped"
}

export interface SagaPlan {
  version: number
  title: string
  grandTheme: string
  totalPlannedChapters: number
  volumes: SagaVolume[]
  currentVolume: string
  currentChapter: number
  globalChekhovsGuns: ChekhovsGun[]
  pacingTargets: {
    highChapters: number // Action/climax chapters
    mediumChapters: number // Development chapters
    lowChapters: number // Rest/worldbuilding chapters
  }
  lastGenerated: number
  lastRevised: number
}

export interface ChapterPlan {
  chapterNumber: number
  title: string
  keyEvents: string[]
  thematicGoal: string
  chekhovsGunsPlanted: string[]
  chekhovsGunsPayoff: string[]
  pacing: "high" | "medium" | "low"
  notes: string
}

export interface SagaAnalysisResult {
  suggestedVolumes: Array<{
    title: string
    description: string
    chapterRange: { start: number; end: number }
    thematicFocus: string
  }>
  suggestedChekhovsGuns: Array<{
    description: string
    suggestedPlantChapter: number
    suggestedPayoffChapter: number
  }>
  pacingAnalysis: {
    currentPacing: "too_fast" | "too_slow" | "balanced"
    suggestion: string
  }
  riskFactors: string[]
  summary: string
}

const DEFAULT_SAGA_PLAN: SagaPlan = {
  version: 1,
  title: "Untitled Saga",
  grandTheme: "To be defined",
  totalPlannedChapters: 0,
  volumes: [],
  currentVolume: "",
  currentChapter: 0,
  globalChekhovsGuns: [],
  pacingTargets: {
    highChapters: 0,
    mediumChapters: 0,
    lowChapters: 0,
  },
  lastGenerated: 0,
  lastRevised: 0,
}

// ============================================================================
// MULTI-ARC ARCHITECT
// ============================================================================

export class MultiArcArchitect {
  private sagaPlan: SagaPlan
  private sagaPlanPath: string
  private initialized: boolean = false

  constructor() {
    this.sagaPlan = { ...DEFAULT_SAGA_PLAN }
    this.sagaPlanPath = resolve(getNovelDataDir(), "saga-plan", "saga_plan.json")
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await this.load()
      this.initialized = true
      log.info("saga_plan_initialized", {
        volumeCount: this.sagaPlan.volumes.length,
        chekhovsGunCount: this.sagaPlan.globalChekhovsGuns.length,
      })
    } catch {
      this.sagaPlan = { ...DEFAULT_SAGA_PLAN }
      this.initialized = true
      log.info("saga_plan_created_fresh")
    }
  }

  // ============================================================================
  // PERSISTENCE
  // ============================================================================

  private async load(): Promise<void> {
    try {
      await access(this.sagaPlanPath)
      const content = await readFile(this.sagaPlanPath, "utf-8")
      this.sagaPlan = JSON.parse(content)
      log.info("saga_plan_loaded", { path: this.sagaPlanPath })
    } catch {
      await this.save()
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.sagaPlanPath), { recursive: true })
    this.sagaPlan.lastRevised = Date.now()
    await writeFile(this.sagaPlanPath, JSON.stringify(this.sagaPlan, null, 2))
    log.info("saga_plan_saved", {
      volumeCount: this.sagaPlan.volumes.length,
      chapterCount: this.sagaPlan.currentChapter,
    })
  }

  // ============================================================================
  // SAGA PLANNING
  // ============================================================================

  async generateLongTermPlan(
    currentChapter: number,
    nextChaptersCount: number,
    grandTheme: string,
    actCount: number = 3,
    storySummary: string = "",
  ): Promise<{
    plan: SagaPlan
    chapterPlans: ChapterPlan[]
    analysis: SagaAnalysisResult
  }> {
    if (!this.initialized) await this.initialize()

    const worldContext = this.buildWorldContext()
    const existingPlan = this.sagaPlan.volumes.length > 0
      ? JSON.stringify(this.sagaPlan.volumes.slice(-2), null, 2)
      : "No existing volumes."

    const prompt = `You are a Master Outliner for a Magnum Opus (epic long-form narrative).

=== GRAND THEME ===
${grandTheme}

=== CURRENT PROGRESS ===
Chapter: ${currentChapter}
Next chapters to plan: ${nextChaptersCount}
Divide into approximately ${actCount} acts.

=== EXISTING PLAN (if any) ===
${existingPlan}

=== WORLD CONTEXT ===
${worldContext}

=== STORY SUMMARY (recent events) ===
${storySummary.substring(0, 2000)}

=== TASK ===
Generate a high-level outline for the next ${nextChaptersCount} chapters, divided into ${actCount} acts.

Requirements:
1. **Structure**: Divide into ${actCount} acts with clear thematic goals.
2. **Chekhov's Guns**: Plant 3-5 seeds for future payoffs. Note where they should pay off.
3. **Pacing**: Ensure a mix of high-tension, medium-development, and low-rest chapters.
4. **Foreshadowing**: Set up the midpoint reversal and climax logically.
5. **Volume Planning**: Suggest how these chapters fit into the larger saga structure.

Output ONLY valid JSON:
{
  "analysis": {
    "suggestedVolumes": [
      {
        "title": "Volume name",
        "description": "What this volume covers",
        "chapterRange": { "start": number, "end": number },
        "thematicFocus": "Main theme of this volume"
      }
    ],
    "suggestedChekhovsGuns": [
      {
        "description": "What is planted",
        "suggestedPlantChapter": number,
        "suggestedPayoffChapter": number
      }
    ],
    "pacingAnalysis": {
      "currentPacing": "too_fast" | "too_slow" | "balanced",
      "suggestion": "How to adjust pacing"
    },
    "riskFactors": ["Potential issues to watch for"],
    "summary": "Brief analysis summary"
  },
  "volumes": [
    {
      "id": "volume_1",
      "title": "Volume title",
      "description": "Overview",
      "chapterRange": { "start": number, "end": number },
      "acts": [
        {
          "id": "act_1",
          "title": "Act title",
          "description": "What happens",
          "chapterRange": { "start": number, "end": number },
          "thematicGoal": "What this act achieves",
          "keyEvents": ["event1", "event2"],
          "chekhovsGuns": [
            {
              "id": "gun_1",
              "description": "What is planted",
              "plantedChapter": number,
              "payoffChapter": number or null,
              "status": "planted" | "developing" | "ready_to_payoff" | "resolved"
            }
          ],
          "midpointReversal": "Optional midpoint twist",
          "climax": "Optional climax description"
        }
      ],
      "grandTheme": "Theme of this volume",
      "majorArcResolution": "What resolves by the end",
      "status": "planned"
    }
  ],
  "chapterPlans": [
    {
      "chapterNumber": number,
      "title": "Chapter title",
      "keyEvents": ["event1", "event2"],
      "thematicGoal": "What this chapter achieves",
      "chekhovsGunsPlanted": ["gun_id"],
      "chekhovsGunsPayoff": ["gun_id"],
      "pacing": "high" | "medium" | "low",
      "notes": "Additional guidance"
    }
  ]
}`

    try {
      const result = await callLLMJson<{
        analysis: SagaAnalysisResult
        volumes: any[]
        chapterPlans: ChapterPlan[]
      }>({
        prompt,
        callType: "long_term_saga_planning",
        temperature: 0.6,
        useRetry: true,
      })

      const data = result.data

      // Update saga plan
      this.sagaPlan.grandTheme = grandTheme
      this.sagaPlan.currentChapter = currentChapter
      this.sagaPlan.totalPlannedChapters = currentChapter + nextChaptersCount

      // Merge or replace volumes
      if (data.volumes && data.volumes.length > 0) {
        const existingIds = new Set(this.sagaPlan.volumes.map((v) => v.id))
        for (const vol of data.volumes) {
          if (!existingIds.has(vol.id)) {
            this.sagaPlan.volumes.push({
              ...vol,
              status: vol.status || "planned",
            })
          }
        }
      }

      // Update Chekhov's guns
      if (data.analysis?.suggestedChekhovsGuns) {
        for (const gun of data.analysis.suggestedChekhovsGuns) {
          this.plantChekhovsGun(
            gun.description,
            gun.suggestedPlantChapter,
            gun.suggestedPayoffChapter,
          )
        }
      }

      // Update pacing targets
      if (data.chapterPlans) {
        let high = 0, medium = 0, low = 0
        for (const ch of data.chapterPlans) {
          if (ch.pacing === "high") high++
          else if (ch.pacing === "medium") medium++
          else low++
        }
        this.sagaPlan.pacingTargets = { highChapters: high, mediumChapters: medium, lowChapters: low }
      }

      this.sagaPlan.lastGenerated = Date.now()
      await this.save()

      log.info("long_term_plan_generated", {
        chaptersPlanned: nextChaptersCount,
        volumes: data.volumes?.length || 0,
        chekhovsGuns: data.analysis?.suggestedChekhovsGuns?.length || 0,
      })

      return {
        plan: this.sagaPlan,
        chapterPlans: data.chapterPlans || [],
        analysis: data.analysis || {
          suggestedVolumes: [],
          suggestedChekhovsGuns: [],
          pacingAnalysis: { currentPacing: "balanced", suggestion: "" },
          riskFactors: [],
          summary: "",
        },
      }
    } catch (error) {
      log.error("long_term_plan_generation_failed", { error: String(error) })
      return {
        plan: this.sagaPlan,
        chapterPlans: [],
        analysis: {
          suggestedVolumes: [],
          suggestedChekhovsGuns: [],
          pacingAnalysis: { currentPacing: "balanced", suggestion: "Plan generation failed" },
          riskFactors: ["Technical error during planning"],
          summary: "Failed to generate long-term plan",
        },
      }
    }
  }

  // ============================================================================
  // CHEKHOV'S GUN MANAGEMENT
  // ============================================================================

  plantChekhovsGun(
    description: string,
    plantChapter: number,
    expectedPayoffChapter?: number,
    expectedPayoffVolume?: string,
  ): string {
    const id = `gun_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
    const gun = {
      id,
      description,
      plantedChapter: plantChapter,
      expectedPayoffChapter: expectedPayoffChapter || null,
      expectedPayoffVolume: expectedPayoffVolume || null,
      status: "planted" as const,
    }
    this.sagaPlan.globalChekhovsGuns.push(gun)
    log.info("chekhovs_gun_planted", { id, plantChapter, expectedPayoffChapter })
    return id
  }

  payoffChekhovsGun(gunId: string, payoffChapter: number): boolean {
    const gun = this.sagaPlan.globalChekhovsGuns.find((g) => g.id === gunId)
    if (!gun) return false

    gun.status = "resolved"
    gun.expectedPayoffChapter = payoffChapter
    log.info("chekhovs_gun_resolved", { gunId, payoffChapter })
    return true
  }

  getActiveChekhovsGuns(): typeof this.sagaPlan.globalChekhovsGuns {
    return this.sagaPlan.globalChekhovsGuns.filter(
      (g) => g.status === "planted" || g.status === "developing" || g.status === "ready_to_payoff",
    )
  }

  getOverdueChekhovsGuns(currentChapter: number, threshold: number = 20): typeof this.sagaPlan.globalChekhovsGuns {
    return this.sagaPlan.globalChekhovsGuns.filter(
      (g) =>
        (g.status === "planted" || g.status === "developing") &&
        g.expectedPayoffChapter !== null &&
        currentChapter - g.plantedChapter > threshold,
    )
  }

  // ============================================================================
  // VOLUME MANAGEMENT
  // ============================================================================

  getCurrentVolume(): SagaVolume | undefined {
    return this.sagaPlan.volumes.find(
      (v) =>
        v.status === "in_progress" ||
        (v.chapterRange.start <= this.sagaPlan.currentChapter &&
         v.chapterRange.end >= this.sagaPlan.currentChapter),
    )
  }

  getNextVolume(): SagaVolume | undefined {
    const current = this.getCurrentVolume()
    if (!current) return this.sagaPlan.volumes[0]

    const idx = this.sagaPlan.volumes.indexOf(current)
    return this.sagaPlan.volumes[idx + 1]
  }

  completeCurrentVolume(): void {
    const volume = this.getCurrentVolume()
    if (volume) {
      volume.status = "completed"
      const next = this.getNextVolume()
      if (next) {
        next.status = "in_progress"
        this.sagaPlan.currentVolume = next.id
      }
      log.info("volume_completed", { volumeId: volume.id })
    }
  }

  // ============================================================================
  // CONTEXT BUILDING FOR PROMPTS
  // ============================================================================

  buildWorldContext(): string {
    const parts: string[] = []

    if (this.sagaPlan.volumes.length > 0) {
      parts.push("## SAGA STRUCTURE")
      for (const vol of this.sagaPlan.volumes) {
        parts.push(`- **${vol.title}** (Ch.${vol.chapterRange.start}-${vol.chapterRange.end}): ${vol.description}`)
      }
      parts.push("")
    }

    if (this.sagaPlan.globalChekhovsGuns.length > 0) {
      const active = this.getActiveChekhovsGuns()
      if (active.length > 0) {
        parts.push("## ACTIVE CHEKHOV'S GUNS (must track)")
        for (const gun of active) {
          parts.push(`- [${gun.status.toUpperCase()}] ${gun.description} (planted Ch.${gun.plantedChapter})`)
        }
        parts.push("")
      }
    }

    if (this.sagaPlan.pacingTargets.highChapters > 0) {
      parts.push("## PACING TARGETS")
      const total = this.sagaPlan.pacingTargets.highChapters + this.sagaPlan.pacingTargets.mediumChapters + this.sagaPlan.pacingTargets.lowChapters
      parts.push(`- High tension: ${this.sagaPlan.pacingTargets.highChapters}/${total} chapters`)
      parts.push(`- Medium development: ${this.sagaPlan.pacingTargets.mediumChapters}/${total} chapters`)
      parts.push(`- Low/rest: ${this.sagaPlan.pacingTargets.lowChapters}/${total} chapters`)
      parts.push("")
    }

    return parts.join("\n") || "No saga plan established yet."
  }

  // ============================================================================
  // ANALYSIS
  // ============================================================================

  analyzeSagaProgress(currentChapter: number, storySummary: string = ""): Promise<SagaAnalysisResult> {
    return this.generateLongTermPlan(currentChapter, 0, this.sagaPlan.grandTheme, 0, storySummary)
      .then((result) => result.analysis)
  }

  // ============================================================================
  // REPORTING
  // ============================================================================

  generateReport(): string {
    const lines: string[] = ["# Saga Plan Report\n"]

    lines.push(`## Overview`)
    lines.push(`- **Title**: ${this.sagaPlan.title}`)
    lines.push(`- **Grand Theme**: ${this.sagaPlan.grandTheme}`)
    lines.push(`- **Current Chapter**: ${this.sagaPlan.currentChapter}`)
    lines.push(`- **Planned Chapters**: ${this.sagaPlan.totalPlannedChapters}`)
    lines.push(`- **Volumes**: ${this.sagaPlan.volumes.length}`)
    lines.push("")

    lines.push(`## Volumes`)
    for (const vol of this.sagaPlan.volumes) {
      lines.push(`### ${vol.title} [${vol.status}]`)
      lines.push(`Chapters ${vol.chapterRange.start} - ${vol.chapterRange.end}`)
      lines.push(`${vol.description}`)
      lines.push(`Grand Theme: ${vol.grandTheme}`)
      lines.push("")

      for (const act of vol.acts) {
        lines.push(`  **${act.title}** (Ch.${act.chapterRange.start}-${act.chapterRange.end})`)
        lines.push(`  ${act.description}`)
        if (act.chekhovsGuns.length > 0) {
          lines.push(`  Chekhov's Guns: ${act.chekhovsGuns.length}`)
        }
        lines.push("")
      }
    }

    const overdue = this.getOverdueChekhovsGuns(this.sagaPlan.currentChapter)
    if (overdue.length > 0) {
      lines.push(`## ⚠️ OVERDUE CHEKHOV'S GUNS (${overdue.length})`)
      for (const gun of overdue) {
        lines.push(`- ${gun.description} (planted Ch.${gun.plantedChapter}, ${this.sagaPlan.currentChapter - gun.plantedChapter} chapters ago)`)
      }
      lines.push("")
    }

    return lines.join("\n")
  }

  // ============================================================================
  // IMPORT/EXPORT
  // ============================================================================

  exportData(): SagaPlan {
    return { ...this.sagaPlan }
  }

  importData(data: SagaPlan): void {
    this.sagaPlan = data
    log.info("saga_plan_imported", { volumeCount: data.volumes.length })
  }

  clear(): void {
    this.sagaPlan = { ...DEFAULT_SAGA_PLAN }
    log.info("saga_plan_cleared")
  }
}

export const multiArcArchitect = new MultiArcArchitect()
