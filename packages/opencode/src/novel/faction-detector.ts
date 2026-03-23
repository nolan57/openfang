import { z } from "zod"
import { Log } from "../util/log"

const log = Log.create({ service: "faction-detector" })

export const FactionMemberSchema = z.object({
  characterName: z.string(),
  role: z.enum(["leader", "member", "sympathizer", "reluctant"]),
  influence: z.number().min(0).max(100),
  joinedChapter: z.number().optional(),
})

export const FactionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum([
    "alliance",
    "opposition",
    "neutral",
    "underground",
    "religious",
    "military",
    "political",
    "economic",
    "ideological",
    "familial",
    "cooperative",
  ]),
  members: z.array(FactionMemberSchema),
  goals: z.array(z.string()),
  resources: z.number().min(0).max(100),
  cohesion: z.number().min(0).max(100),
  publicStance: z.enum(["public", "secret", "hidden", "rumored"]),
  formedChapter: z.number(),
  dissolvedChapter: z.number().optional(),
  relationships: z.record(z.string(), z.enum(["ally", "enemy", "neutral", "tense", "cooperative"])),
  lifecycleStage: z.enum(["forming", "stable", "fracturing", "dissolving"]),
  cohesionHistory: z.array(z.number()).optional(),
})

export type Faction = z.infer<typeof FactionSchema>
export type FactionMember = z.infer<typeof FactionMemberSchema>

export interface RelationshipData {
  trust: number
  hostility: number
  dominance: number
  friendliness: number
  attachmentStyle?: string
}

export interface FactionDetectionResult {
  factions: Faction[]
  detectedAt: number
  confidence: number
  unalignedCharacters: string[]
  newlyFormedFactions: string[]
  dissolvedFactions: string[]
  stageChangedFactions: Array<{ id: string; from: string; to: string }>
}

export interface FactionConfig {
  minMembersForFaction: number
  trustThresholdForAlliance: number
  hostilityThresholdForOpposition: number
  cohesionThreshold: number
}

const DEFAULT_CONFIG: FactionConfig = {
  minMembersForFaction: 2,
  trustThresholdForAlliance: 50,
  hostilityThresholdForOpposition: 60,
  cohesionThreshold: 30,
}

export class FactionDetector {
  private factions: Map<string, Faction> = new Map()
  private config: FactionConfig

  constructor(config: Partial<FactionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  detectFactions(
    characters: Record<string, any>,
    relationships: Record<string, RelationshipData>,
    currentChapter: number,
  ): FactionDetectionResult {
    const characterNames = Object.keys(characters)
    const adjacencyList = this.buildAdjacencyList(characterNames, relationships)
    const connectedComponents = this.findConnectedComponents(characterNames, adjacencyList)

    const factions: Faction[] = []
    const processedCharacters = new Set<string>()
    const newlyFormedFactions: string[] = []
    const dissolvedFactions: string[] = []
    const stageChangedFactions: Array<{ id: string; from: string; to: string }> = []

    for (const component of connectedComponents) {
      if (component.length < this.config.minMembersForFaction) continue

      const factionType = this.determineFactionType(component, relationships)
      const cohesion = this.calculateCohesion(component, relationships)

      if (cohesion < this.config.cohesionThreshold) continue

      const faction = this.createFaction(component, relationships, factionType, cohesion, currentChapter)

      const existingFaction = this.factions.get(faction.name)
      if (!existingFaction) {
        newlyFormedFactions.push(faction.id)
      }

      factions.push(faction)

      for (const char of component) {
        processedCharacters.add(char)
      }
    }

    for (const existingFaction of this.factions.values()) {
      if (!existingFaction.dissolvedChapter) {
        const oldStage = existingFaction.lifecycleStage
        const stillActive = this.checkFactionStillActive(existingFaction, relationships, currentChapter)

        if (!stillActive && !existingFaction.dissolvedChapter) {
          existingFaction.dissolvedChapter = currentChapter
          existingFaction.lifecycleStage = "dissolving"
          this.factions.set(existingFaction.id, existingFaction)
          dissolvedFactions.push(existingFaction.id)
          log.info("faction_dissolved", { id: existingFaction.id, name: existingFaction.name })
        } else if (oldStage !== existingFaction.lifecycleStage) {
          stageChangedFactions.push({
            id: existingFaction.id,
            from: oldStage,
            to: existingFaction.lifecycleStage,
          })
          log.info("faction_stage_changed", {
            id: existingFaction.id,
            from: oldStage,
            to: existingFaction.lifecycleStage,
          })
        }
      }
    }

    for (const faction of factions) {
      this.factions.set(faction.id, faction)
      log.info("faction_detected", {
        id: faction.id,
        name: faction.name,
        type: faction.type,
        members: faction.members.length,
        cohesion: faction.cohesion.toFixed(1),
        lifecycleStage: faction.lifecycleStage,
      })
    }

    this._inferInterFactionRelationships(factions, relationships)

    const unalignedCharacters = characterNames.filter((c) => !processedCharacters.has(c))

    const avgCohesion = factions.length > 0 ? factions.reduce((sum, f) => sum + f.cohesion, 0) / factions.length : 0

    return {
      factions,
      detectedAt: Date.now(),
      confidence: avgCohesion / 100,
      unalignedCharacters,
      newlyFormedFactions,
      dissolvedFactions,
      stageChangedFactions,
    }
  }

  private buildAdjacencyList(
    characters: string[],
    relationships: Record<string, RelationshipData>,
  ): Map<string, Set<string>> {
    const adjacency = new Map<string, Set<string>>()

    for (const char of characters) {
      adjacency.set(char, new Set())
    }

    for (const [key, rel] of Object.entries(relationships)) {
      const [charA, charB] = key.split("-")
      if (!charA || !charB) continue

      const isAllied = rel.trust >= this.config.trustThresholdForAlliance && rel.hostility < 30
      const isOpposition = rel.hostility >= this.config.hostilityThresholdForOpposition

      if (isAllied || isOpposition) {
        adjacency.get(charA)?.add(charB)
        adjacency.get(charB)?.add(charA)
      }
    }

    return adjacency
  }

  private findConnectedComponents(characters: string[], adjacency: Map<string, Set<string>>): string[][] {
    const visited = new Set<string>()
    const components: string[][] = []

    for (const char of characters) {
      if (visited.has(char)) continue

      const component: string[] = []
      const stack = [char]

      while (stack.length > 0) {
        const current = stack.pop()!
        if (visited.has(current)) continue

        visited.add(current)
        component.push(current)

        const neighbors = adjacency.get(current) || new Set()
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            stack.push(neighbor)
          }
        }
      }

      if (component.length > 0) {
        components.push(component)
      }
    }

    return components
  }

  private determineFactionType(members: string[], relationships: Record<string, RelationshipData>): Faction["type"] {
    let totalTrust = 0
    let totalHostility = 0
    let relationshipCount = 0

    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = `${members[i]}-${members[j]}`
        const reverseKey = `${members[j]}-${members[i]}`
        const rel = relationships[key] || relationships[reverseKey]

        if (rel) {
          totalTrust += rel.trust
          totalHostility += rel.hostility
          relationshipCount++
        }
      }
    }

    if (relationshipCount === 0) return "neutral"

    const avgTrust = totalTrust / relationshipCount
    const avgHostility = totalHostility / relationshipCount

    if (avgTrust >= 70 && avgHostility < 20) return "alliance"
    if (avgHostility >= 60) return "opposition"
    if (avgTrust >= 40 && avgHostility < 40) return "cooperative"

    return "neutral"
  }

  private calculateCohesion(members: string[], relationships: Record<string, RelationshipData>): number {
    if (members.length < 2) return 0

    let cohesionScore = 0
    let pairCount = 0

    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = `${members[i]}-${members[j]}`
        const reverseKey = `${members[j]}-${members[i]}`
        const rel = relationships[key] || relationships[reverseKey]

        if (rel) {
          const trustFactor = (rel.trust + 100) / 200
          const hostilityFactor = 1 - rel.hostility / 100
          cohesionScore += (trustFactor * 0.6 + hostilityFactor * 0.4) * 100
          pairCount++
        }
      }
    }

    return pairCount > 0 ? cohesionScore / pairCount : 0
  }

  private createFaction(
    members: string[],
    relationships: Record<string, RelationshipData>,
    type: Faction["type"],
    cohesion: number,
    chapter: number,
  ): Faction {
    const id = `faction_${chapter}_${Date.now()}`
    const name = this.generateFactionName(type, members)

    const factionMembers: FactionMember[] = members.map((char, index) => {
      const influence = this.calculateMemberInfluence(char, members, relationships)
      const role = index === 0 ? "leader" : influence > 50 ? "member" : "sympathizer"

      return {
        characterName: char,
        role,
        influence,
        joinedChapter: chapter,
      }
    })

    factionMembers.sort((a, b) => b.influence - a.influence)
    if (factionMembers.length > 0 && factionMembers[0].role !== "leader") {
      factionMembers[0].role = "leader"
    }

    return {
      id,
      name,
      type,
      members: factionMembers,
      goals: [],
      resources: 50,
      cohesion,
      publicStance: "public",
      formedChapter: chapter,
      relationships: {},
      lifecycleStage: "forming",
      cohesionHistory: [cohesion],
    }
  }

  private calculateMemberInfluence(
    character: string,
    members: string[],
    relationships: Record<string, RelationshipData>,
  ): number {
    let influence = 50

    for (const other of members) {
      if (other === character) continue

      const key = `${character}-${other}`
      const rel = relationships[key]

      if (rel) {
        influence += rel.dominance * 0.3
        influence += rel.trust * 0.1
      }
    }

    return Math.min(100, Math.max(0, influence))
  }

  private generateFactionName(type: Faction["type"], members: string[]): string {
    const typeNames: Record<Faction["type"], string> = {
      alliance: "Alliance",
      opposition: "Opposition",
      neutral: "Group",
      underground: "Underground",
      religious: "Order",
      military: "Force",
      political: "Party",
      economic: "Consortium",
      ideological: "Movement",
      familial: "Family",
      cooperative: "Coalition",
    }

    if (members.length <= 3) {
      return `${members.join(" & ")} ${typeNames[type]}`
    }

    return `${members[0]}'s ${typeNames[type]}`
  }

  private checkFactionStillActive(
    faction: Faction,
    relationships: Record<string, RelationshipData>,
    currentChapter: number,
  ): boolean {
    const activeMembers = faction.members.filter((m) => m.role !== "reluctant")

    if (activeMembers.length < this.config.minMembersForFaction) {
      faction.lifecycleStage = "dissolving"
      return false
    }

    const cohesion = this.calculateCohesion(
      activeMembers.map((m) => m.characterName),
      relationships,
    )

    if (faction.cohesionHistory) {
      faction.cohesionHistory.push(cohesion)
      if (faction.cohesionHistory.length > 5) {
        faction.cohesionHistory.shift()
      }
    } else {
      faction.cohesionHistory = [cohesion]
    }

    faction.cohesion = cohesion

    const oldStage = faction.lifecycleStage

    if (cohesion < this.config.cohesionThreshold * 0.5) {
      faction.lifecycleStage = "dissolving"
    } else if (cohesion < this.config.cohesionThreshold) {
      faction.lifecycleStage = "fracturing"
    } else if (cohesion >= this.config.cohesionThreshold * 1.3 && faction.members.length >= 4) {
      faction.lifecycleStage = "stable"
    } else if (oldStage === "forming" && cohesion >= this.config.cohesionThreshold) {
      faction.lifecycleStage = "stable"
    }

    const ageInChapters = currentChapter - faction.formedChapter
    if (ageInChapters < 2 && cohesion >= this.config.cohesionThreshold) {
      faction.lifecycleStage = "forming"
    }

    return cohesion >= this.config.cohesionThreshold * 0.5
  }

  private _inferInterFactionRelationships(factions: Faction[], relationships: Record<string, RelationshipData>): void {
    for (let i = 0; i < factions.length; i++) {
      for (let j = i + 1; j < factions.length; j++) {
        const factionA = factions[i]
        const factionB = factions[j]

        const crossRelations = this._calculateCrossFactionRelations(factionA, factionB, relationships)

        factionA.relationships[factionB.id] = crossRelations.stance
        factionB.relationships[factionA.id] = crossRelations.stance

        log.debug("inter_faction_relation_inferred", {
          factionA: factionA.name,
          factionB: factionB.name,
          avgTrust: crossRelations.avgTrust.toFixed(1),
          avgHostility: crossRelations.avgHostility.toFixed(1),
          stance: crossRelations.stance,
        })
      }
    }
  }

  private _calculateCrossFactionRelations(
    factionA: Faction,
    factionB: Faction,
    relationships: Record<string, RelationshipData>,
  ): { avgTrust: number; avgHostility: number; stance: Faction["relationships"][string] } {
    let totalTrust = 0
    let totalHostility = 0
    let pairCount = 0

    for (const memberA of factionA.members) {
      for (const memberB of factionB.members) {
        const key = `${memberA.characterName}-${memberB.characterName}`
        const reverseKey = `${memberB.characterName}-${memberA.characterName}`
        const rel = relationships[key] || relationships[reverseKey]

        if (rel) {
          totalTrust += rel.trust
          totalHostility += rel.hostility
          pairCount++
        }
      }
    }

    if (pairCount === 0) {
      return { avgTrust: 0, avgHostility: 0, stance: "neutral" }
    }

    const avgTrust = totalTrust / pairCount
    const avgHostility = totalHostility / pairCount

    let stance: Faction["relationships"][string] = "neutral"
    if (avgTrust >= 60 && avgHostility < 30) {
      stance = "ally"
    } else if (avgHostility >= 50) {
      stance = "enemy"
    } else if (avgTrust >= 40 && avgHostility < 40) {
      stance = "cooperative"
    } else if (avgHostility >= 30 || avgTrust < 30) {
      stance = "tense"
    }

    return { avgTrust, avgHostility, stance }
  }

  getFaction(id: string): Faction | undefined {
    return this.factions.get(id)
  }

  getAllFactions(): Faction[] {
    return Array.from(this.factions.values()).filter((f) => !f.dissolvedChapter)
  }

  getCharacterFactions(characterName: string): Faction[] {
    return this.getAllFactions().filter((f) => f.members.some((m) => m.characterName === characterName))
  }

  updateFactionRelationships(
    factionAId: string,
    factionBId: string,
    stance: Faction["relationships"][string],
  ): boolean {
    const factionA = this.factions.get(factionAId)
    const factionB = this.factions.get(factionBId)

    if (!factionA || !factionB) return false

    factionA.relationships[factionBId] = stance
    factionB.relationships[factionAId] = stance

    this.factions.set(factionAId, factionA)
    this.factions.set(factionBId, factionB)

    log.info("faction_relationship_updated", {
      factionA: factionAId,
      factionB: factionBId,
      stance,
    })

    return true
  }

  getFactionRelationsReport(): string {
    const factions = this.getAllFactions()
    const lines: string[] = ["# Faction Relations Report\n"]

    for (const faction of factions) {
      lines.push(`## ${faction.name} (${faction.type})`)
      lines.push(`- Members: ${faction.members.map((m) => `${m.characterName} (${m.role})`).join(", ")}`)
      lines.push(`- Cohesion: ${faction.cohesion.toFixed(1)}%`)
      lines.push(`- Resources: ${faction.resources}%`)
      lines.push(`- Stance: ${faction.publicStance}`)

      if (Object.keys(faction.relationships).length > 0) {
        lines.push("- Relations:")
        for (const [otherId, stance] of Object.entries(faction.relationships)) {
          const other = this.factions.get(otherId)
          if (other) {
            lines.push(`  - ${other.name}: ${stance}`)
          }
        }
      }
      lines.push("")
    }

    return lines.join("\n")
  }

  clear(): void {
    this.factions.clear()
    log.info("factions_cleared")
  }
}

export const factionDetector = new FactionDetector()
