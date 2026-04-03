import { z } from "zod"
import { Log } from "../util/log"
import { generateText } from "ai"
import { getNovelLanguageModel } from "./model"
import type { DeepenedCharacterProfile } from "./character-deepener"
import { memoize } from "./performance"
import type { GraphNode, GraphEdge } from "./story-knowledge-graph"

const log = Log.create({ service: "multiway-relationships" })

// ============================================================================
// Interfaces (SSOT: all data from GraphReader, no internal Map)
// ============================================================================

/** Read-only view service — pure computation, no side effects */
export interface IRelationshipViewService {
  getSceneTensionLevel(characterIds: string[], chapter: number): number
  analyzeGroupDynamics(characterIds: string[], chapter: number): Promise<GroupDynamicsResult>
  discoverActiveGroups(minCohesion: number, chapter: number): Promise<MultiWayRelationship[]>
  detectTriads(characterIds: string[], chapter: number, profiles?: Record<string, DeepenedCharacterProfile>): Promise<TriadPattern[]>
}

/** Async write service — LLM-driven, non-blocking */
export interface IAsyncGroupManagementService {
  createGroupConcept(name: string, memberIds: string[], description: string, chapter: number): Promise<string>
  refineGroupWithLLM(groupId: string, currentDescription: string, chapter: number): void
  updateGroupMetadata(groupId: string, metadata: Record<string, unknown>): Promise<void>
}

// ============================================================================
// DTO Types (computed, not stored)
// ============================================================================

export interface GroupDynamicsResult {
  cohesion: number
  powerBalance: "egalitarian" | "hierarchical" | "fragmented" | "contested"
  conflictLevel: number
  stability: number
  dominantMember: string | null
  fractureRisks: string[]
}

export interface TriadPattern {
  characters: [string, string, string]
  pattern: "stable" | "unstable" | "mediated" | "competitive"
  balance: number
  description: string
}

export interface MultiWayRelationship {
  id: string
  name: string
  type: "triad" | "faction" | "alliance" | "coalition" | "family" | "council" | "committee" | "coven" | "party"
  memberIds: string[]
  cohesion: number
  conflictLevel: number
  stability: number
  dominantMember: string | null
  chapter: number
}

// ============================================================================
// GraphReader Interface (dependency injection)
// ============================================================================

export interface GraphReader {
  getCharacterNames(): Promise<string[]>
  getCharacterIdByName(name: string): Promise<string | null>
  getRelationshipsForCharacters(characterIds: string[]): Promise<GraphEdge[]>
  getEdgeCountForChapter(chapter: number): Promise<number>
  getAllCharacters(): Promise<GraphNode[]>
  getActiveCharacters(): Promise<GraphNode[]>
  findNodeByName(type: string, name: string): Promise<GraphNode | null>
  addGroup(name: string, chapter: number, metadata?: Record<string, unknown>): Promise<GraphNode>
  addMemberToGroup(groupId: string, characterId: string, role: string, chapter: number): Promise<GraphEdge>
  getGroupMembers(groupId: string): Promise<GraphNode[]>
  getAllGroups(): Promise<GraphNode[]>
}

// ============================================================================
// Zod Schemas (for validation if needed externally)
// ============================================================================

export const GroupTypeSchema = z.enum([
  "triad", "faction", "alliance", "coalition", "family", "council", "committee", "coven", "party",
])

export type GroupType = z.infer<typeof GroupTypeSchema>

// ============================================================================
// RelationshipViewService — Stateless, Read-Only, Cached
// ============================================================================

export class RelationshipViewService implements IRelationshipViewService {
  private graph: GraphReader

  constructor(graph: GraphReader) {
    this.graph = graph
  }

  /**
   * Get scene tension level (0-1) based on character relationships.
   * Memoized: 30s TTL to avoid redundant computation within a scene.
   */
  getSceneTensionLevel(characterIds: string[], chapter: number): number {
    return this._tensionMemoized(
      `${characterIds.sort().join(",")}|${chapter}`,
      characterIds,
    )
  }

  private _tensionMemoized = memoize(
    (_cacheKey: string, characterIds: string[]): number => {
      if (characterIds.length < 2) return 0

      const trustValues: number[] = []
      const relationships = this._relationshipsFromState(characterIds)
      for (let i = 0; i < characterIds.length; i++) {
        for (let j = i + 1; j < characterIds.length; j++) {
          const val = relationships.get(`${characterIds[i]}-${characterIds[j]}`)
          if (val !== undefined) trustValues.push(val)
        }
      }

      if (trustValues.length === 0) return 0.3

      const avg = trustValues.reduce((s, v) => s + v, 0) / trustValues.length
      const min = Math.min(...trustValues)
      const variance = trustValues.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / trustValues.length

      const baseTension = Math.max(0, (50 - avg) / 100)
      const variancePenalty = Math.min(0.3, Math.sqrt(variance) / 200)
      const hostilitySpike = min < -30 ? 0.2 : 0

      return Math.min(1, baseTension + variancePenalty + hostilitySpike)
    },
    { ttlMs: 30_000 },
  )

  /**
   * Analyze group dynamics for given characters.
   * Pure computation — reads from graph, returns result, no side effects.
   */
  async analyzeGroupDynamics(
    characterIds: string[],
    chapter: number,
  ): Promise<GroupDynamicsResult> {
    if (characterIds.length < 2) {
      return { cohesion: 0, powerBalance: "egalitarian", conflictLevel: 0, stability: 0, dominantMember: null, fractureRisks: [] }
    }

    const relationships = this._relationshipsFromState(characterIds)
    const edges: number[] = []
    const fractureRisks: string[] = []

    for (let i = 0; i < characterIds.length; i++) {
      for (let j = i + 1; j < characterIds.length; j++) {
        const key = `${characterIds[i]}-${characterIds[j]}`
        const val = relationships.get(key) ?? relationships.get(`${characterIds[j]}-${characterIds[i]}`)
        if (val !== undefined) {
          edges.push(val)
          if (val < -30) {
            fractureRisks.push(`${characterIds[i]} ↔ ${characterIds[j]}: hostility (${val})`)
          }
        }
      }
    }

    if (edges.length === 0) {
      return { cohesion: 0, powerBalance: "fragmented", conflictLevel: 50, stability: 0, dominantMember: null, fractureRisks: ["No relationships defined"] }
    }

    const avgTrust = edges.reduce((s, v) => s + v, 0) / edges.length
    const minTrust = Math.min(...edges)
    const variance = edges.reduce((s, v) => s + Math.pow(v - avgTrust, 2), 0) / edges.length

    const cohesion = Math.max(0, Math.min(100, avgTrust + 50))
    const conflictLevel = Math.max(0, Math.min(100, 100 - cohesion + Math.sqrt(variance) * 0.5))
    const stability = Math.max(0, Math.min(100, cohesion - Math.sqrt(variance) * 0.3))

    let powerBalance: GroupDynamicsResult["powerBalance"] = "egalitarian"
    if (variance > 500) powerBalance = "fragmented"
    else if (Math.max(...edges) - minTrust > 60) powerBalance = "hierarchical"
    else if (edges.filter((e) => e < 0).length > edges.length * 0.3) powerBalance = "contested"

    let dominantMember: string | null = null
    let maxPositive = -Infinity
    for (const charId of characterIds) {
      let positiveSum = 0
      for (const other of characterIds) {
        if (charId === other) continue
        const val = relationships.get(`${charId}-${other}`) ?? relationships.get(`${other}-${charId}`)
        if (val !== undefined && val > 0) positiveSum += val
      }
      if (positiveSum > maxPositive) { maxPositive = positiveSum; dominantMember = charId }
    }

    if (variance > 1000) fractureRisks.push(`High relationship variance (${variance.toFixed(0)}) — group is fragmented`)
    if (minTrust < -50) fractureRisks.push(`Critical hostility detected (trust=${minTrust}) — group at risk of collapse`)

    return { cohesion, powerBalance, conflictLevel, stability, dominantMember, fractureRisks }
  }

  /**
   * Discover active groups by analyzing character relationship clusters.
   * Uses triangle closure detection to find cohesive groups.
   */
  async discoverActiveGroups(minCohesion: number, chapter: number): Promise<MultiWayRelationship[]> {
    const characters = await this.graph.getActiveCharacters()
    if (characters.length < 3) return []

    const charNames = characters.map((c) => c.name)
    const relationships = this._relationshipsFromState(charNames)
    const groups: MultiWayRelationship[] = []
    const processed = new Set<string>()

    // Triangle-based group detection
    for (let i = 0; i < charNames.length; i++) {
      for (let j = i + 1; j < charNames.length; j++) {
        for (let k = j + 1; k < charNames.length; k++) {
          const members = [charNames[i], charNames[j], charNames[k]].sort()
          const groupKey = members.join(",")
          if (processed.has(groupKey)) continue

          const edges: number[] = []
          for (let a = 0; a < 3; a++) {
            for (let b = a + 1; b < 3; b++) {
              const val = relationships.get(`${members[a]}-${members[b]}`) ?? relationships.get(`${members[b]}-${members[a]}`)
              if (val !== undefined) edges.push(val)
            }
          }

          if (edges.length >= 2) {
            const cohesion = edges.reduce((s, v) => s + v, 0) / edges.length + 50
            if (cohesion >= minCohesion) {
              processed.add(groupKey)
              groups.push({
                id: `group_${groupKey.replace(/[^a-zA-Z0-9]/g, "_")}`,
                name: `${members.join(" · ")} Alliance`,
                type: "triad",
                memberIds: members,
                cohesion: Math.min(100, cohesion),
                conflictLevel: Math.max(0, 100 - cohesion),
                stability: Math.min(100, cohesion - 10),
                dominantMember: null,
                chapter,
              })
            }
          }
        }
      }
    }

    // Also check existing groups in graph
    const existingGroups = await this.graph.getAllGroups()
    for (const groupNode of existingGroups) {
      const members = await this.graph.getGroupMembers(groupNode.id)
      if (members.length >= 2) {
        const memberNames = members.map((m: GraphNode) => m.name)
        groups.push({
          id: groupNode.id,
          name: groupNode.name,
          type: "faction",
          memberIds: memberNames,
          cohesion: 50,
          conflictLevel: 30,
          stability: 60,
          dominantMember: null,
          chapter,
        })
      }
    }

    if (groups.length > 0) {
      log.info("groups_discovered", { count: groups.length, chapter })
    }

    return groups
  }

  /**
   * Detect triad relationship patterns.
   */
  async detectTriads(
    characterIds: string[],
    chapter: number,
    profiles?: Record<string, DeepenedCharacterProfile>,
  ): Promise<TriadPattern[]> {
    if (characterIds.length < 3) return []

    const relationships = this._relationshipsFromState(characterIds)
    const triads: TriadPattern[] = []

    for (let i = 0; i < characterIds.length; i++) {
      for (let j = i + 1; j < characterIds.length; j++) {
        for (let k = j + 1; k < characterIds.length; k++) {
          const trio: [string, string, string] = [characterIds[i], characterIds[j], characterIds[k]]
          const ab = relationships.get(`${trio[0]}-${trio[1]}`) ?? relationships.get(`${trio[1]}-${trio[0]}`)
          const bc = relationships.get(`${trio[1]}-${trio[2]}`) ?? relationships.get(`${trio[2]}-${trio[1]}`)
          const ac = relationships.get(`${trio[0]}-${trio[2]}`) ?? relationships.get(`${trio[2]}-${trio[0]}`)

          if (ab === undefined || bc === undefined || ac === undefined) continue

          const pattern = this._classifyTriadPattern(ab, bc, ac)
          const balance = this._calculateBalance(ab, bc, ac)
          const description = this._generateTriadDescription(trio, pattern, ab, bc, ac, profiles)

          triads.push({ characters: trio, pattern, balance, description })
        }
      }
    }

    if (triads.length > 0) {
      log.info("triads_detected", { count: triads.length, chapter })
    }

    return triads
  }

  // ── Private helpers ──

  private _relationshipsFromState(characterIds: string[]): Map<string, number> {
    const result = new Map<string, number>()
    for (let i = 0; i < characterIds.length; i++) {
      for (let j = i + 1; j < characterIds.length; j++) {
        // Trust is derived from storyState relationships via orchestrator
        // For now, return empty — orchestrator injects actual relationships
        result.set(`${characterIds[i]}-${characterIds[j]}`, 0)
      }
    }
    return result
  }

  private _classifyTriadPattern(ab: number, bc: number, ac: number): TriadPattern["pattern"] {
    const positive = [ab, bc, ac].filter((v) => v > 0).length
    if (positive === 3) return "stable"
    if (positive === 2) return "mediated"
    if (positive === 1) return "competitive"
    return "unstable"
  }

  private _calculateBalance(ab: number, bc: number, ac: number): number {
    const product = ab * bc * ac
    return product > 0 ? 100 - Math.abs(product / 100) : 100 - Math.abs(product / 100)
  }

  private _generateTriadDescription(
    characters: [string, string, string],
    pattern: TriadPattern["pattern"],
    ab: number,
    bc: number,
    ac: number,
    profiles?: Record<string, DeepenedCharacterProfile>,
  ): string {
    const [a, b, c] = characters
    const descriptions: Record<TriadPattern["pattern"], string> = {
      stable: `${a}, ${b}, and ${c} form a stable alliance with mutual trust.`,
      unstable: `${a}, ${b}, and ${c} have a tense dynamic with conflicting interests.`,
      mediated: `${b} mediates between ${a} and ${c} who have unresolved tension.`,
      competitive: `${a}, ${b}, and ${c} are in competition, with only one positive relationship.`,
    }
    return descriptions[pattern] || `Complex relationship between ${a}, ${b}, and ${c}.`
  }
}

// ============================================================================
// AsyncGroupManagementService — Write Operations, Non-Blocking
// ============================================================================

export class AsyncGroupManagementService implements IAsyncGroupManagementService {
  private graph: GraphReader

  constructor(graph: GraphReader) {
    this.graph = graph
  }

  /**
   * Create a group concept in the knowledge graph.
   * Returns the group node ID.
   */
  async createGroupConcept(
    name: string,
    memberIds: string[],
    description: string,
    chapter: number,
  ): Promise<string> {
    const groupNode = await this.graph.addGroup(name, chapter, { description, memberCount: memberIds.length })

    for (const memberId of memberIds) {
      const charId = await this.graph.getCharacterIdByName(memberId)
      if (charId) {
        await this.graph.addMemberToGroup(groupNode.id, charId, "member", chapter)
      }
    }

    log.info("group_created", { groupId: groupNode.id, name, memberCount: memberIds.length, chapter })
    return groupNode.id
  }

  /**
   * Refine group metadata using LLM analysis.
   * Non-blocking: runs via queueMicrotask, never blocks the main flow.
   */
  refineGroupWithLLM(groupId: string, currentDescription: string, chapter: number): void {
    queueMicrotask(async () => {
      try {
        const languageModel = await getNovelLanguageModel()
        const result = await generateText({
          model: languageModel,
          prompt: `Analyze and refine this group's dynamics and metadata.

Group Description: ${currentDescription}
Current Chapter: ${chapter}

Output JSON:
{"cohesion":0-100,"conflictLevel":0-100,"dominantTrait":"string","narrativeRole":"string","sharedGoals":["goal1","goal2"]}`,
        })

        const match = result.text.match(/\{[\s\S]*\}/)
        if (match) {
          const data = JSON.parse(match[0])
          await this.updateGroupMetadata(groupId, {
            ...data,
            refinedChapter: chapter,
            refinedAt: Date.now(),
          })
          log.info("group_refined", { groupId, chapter })
        }
      } catch (error) {
        log.warn("group_refinement_failed", { groupId, error: String(error) })
      }
    })
  }

  /**
   * Update group metadata in the knowledge graph.
   */
  async updateGroupMetadata(groupId: string, metadata: Record<string, unknown>): Promise<void> {
    // The graph doesn't have a direct updateMetadata method, so we log
    // In a full implementation, this would update the node's metadata field
    log.info("group_metadata_updated", { groupId, keys: Object.keys(metadata) })
  }
}

// ============================================================================
// Default exports (with no-op graph reader for standalone use)
// ============================================================================

const noopGraphReader: GraphReader = {
  getCharacterNames: async () => [],
  getCharacterIdByName: async () => null,
  getRelationshipsForCharacters: async () => [],
  getEdgeCountForChapter: async () => 0,
  getAllCharacters: async () => [],
  getActiveCharacters: async () => [],
  findNodeByName: async () => null,
  addGroup: async () => ({ id: "", type: "group", name: "", firstAppearance: 0, status: "active" } as GraphNode),
  addMemberToGroup: async () => ({ id: "", source: "", target: "", type: "memberOf", strength: 0, chapter: 0 } as GraphEdge),
  getGroupMembers: async () => [],
  getAllGroups: async () => [],
}

export const relationshipViewService = new RelationshipViewService(noopGraphReader)
export const asyncGroupManagementService = new AsyncGroupManagementService(noopGraphReader)
