import { z } from "zod"
import { Log } from "../util/log"
import { generateText } from "ai"
import { getNovelLanguageModel } from "./model"

const log = Log.create({ service: "multiway-relationships" })

export const GroupTypeSchema = z.enum([
  "triad",
  "quad",
  "faction",
  "family",
  "council",
  "committee",
  "alliance",
  "coalition",
  "coven",
  "party",
])

export const GroupRoleSchema = z.enum([
  "leader",
  "second_in_command",
  "member",
  "outcast",
  "mediator",
  "challenger",
  "newcomer",
  "elder",
])

export const GroupDynamicsSchema = z.object({
  cohesion: z.number().min(0).max(100),
  powerBalance: z.enum(["egalitarian", "hierarchical", "fragmented", "contested"]),
  communicationPattern: z.enum(["direct", "hub_and_spoke", "clique_based", "fragmented"]),
  decisionMaking: z.enum(["democratic", "authoritarian", "consensus", "chaotic"]),
  conflictLevel: z.number().min(0).max(100),
  stability: z.number().min(0).max(100),
})

export const GroupMemberSchema = z.object({
  characterName: z.string(),
  role: GroupRoleSchema,
  influence: z.number().min(0).max(100),
  loyalty: z.number().min(0).max(100),
  joinedChapter: z.number(),
  contributions: z.array(z.string()),
  conflicts: z.array(z.string()),
})

export const GroupRelationshipSchema = z.object({
  sourceGroupId: z.string(),
  targetGroupId: z.string(),
  type: z.enum(["alliance", "rivalry", "subordinate", "neutral", "hostile", "cooperative"]),
  strength: z.number().min(0).max(100),
  description: z.string(),
})

export const MultiWayRelationshipSchema = z.object({
  id: z.string(),
  type: GroupTypeSchema,
  name: z.string(),
  description: z.string(),
  members: z.array(GroupMemberSchema),
  dynamics: GroupDynamicsSchema,
  relationships: z.array(GroupRelationshipSchema).optional(),
  formedChapter: z.number(),
  dissolvedChapter: z.number().optional(),
  sharedGoals: z.array(z.string()),
  sharedResources: z.array(z.string()),
  secrets: z.array(z.string()),
  history: z.array(
    z.object({
      chapter: z.number(),
      event: z.string(),
      impact: z.string(),
    }),
  ),
})

export type GroupType = z.infer<typeof GroupTypeSchema>
export type GroupRole = z.infer<typeof GroupRoleSchema>
export type GroupDynamics = z.infer<typeof GroupDynamicsSchema>
export type GroupMember = z.infer<typeof GroupMemberSchema>
export type GroupRelationship = z.infer<typeof GroupRelationshipSchema>
export type MultiWayRelationship = z.infer<typeof MultiWayRelationshipSchema>

export interface TriadPattern {
  characters: [string, string, string]
  pattern: "stable" | "unstable" | "mediated" | "competitive"
  balance: number
  description: string
}

export class MultiWayRelationshipManager {
  private groups: Map<string, MultiWayRelationship> = new Map()
  private characterGroups: Map<string, Set<string>> = new Map()

  async detectTriads(
    characters: Record<string, any>,
    relationships: Record<string, any>,
    currentChapter: number,
  ): Promise<TriadPattern[]> {
    const charNames = Object.keys(characters)
    const triads: TriadPattern[] = []

    for (let i = 0; i < charNames.length; i++) {
      for (let j = i + 1; j < charNames.length; j++) {
        for (let k = j + 1; k < charNames.length; k++) {
          const triadChars: [string, string, string] = [charNames[i], charNames[j], charNames[k]]
          const pattern = await this.analyzeTriad(triadChars, relationships)
          if (pattern) {
            triads.push(pattern)
          }
        }
      }
    }

    log.info("triads_detected", { count: triads.length, chapter: currentChapter })
    return triads
  }

  private async analyzeTriad(
    characters: [string, string, string],
    relationships: Record<string, any>,
  ): Promise<TriadPattern | null> {
    const [a, b, c] = characters

    const relAB = this.getRelationshipValue(relationships, a, b)
    const relBC = this.getRelationshipValue(relationships, b, c)
    const relAC = this.getRelationshipValue(relationships, a, c)

    if (relAB === null || relBC === null || relAC === null) {
      return null
    }

    const balance = this.calculateBalance(relAB, relBC, relAC)
    const pattern = this.classifyTriadPattern(relAB, relBC, relAC)

    return {
      characters,
      pattern,
      balance,
      description: this.generateTriadDescription(characters, pattern, relAB, relBC, relAC),
    }
  }

  private getRelationshipValue(relationships: Record<string, any>, charA: string, charB: string): number | null {
    const key1 = `${charA}-${charB}`
    const key2 = `${charB}-${charA}`
    const rel = relationships[key1] || relationships[key2]

    if (!rel) return null
    return typeof rel.trust === "number" ? rel.trust : null
  }

  private calculateBalance(ab: number, bc: number, ac: number): number {
    const product = ab * bc * ac
    return product > 0 ? 100 - Math.abs(product / 100) : 100 - Math.abs(product / 100)
  }

  private classifyTriadPattern(ab: number, bc: number, ac: number): "stable" | "unstable" | "mediated" | "competitive" {
    const positive = [ab, bc, ac].filter((v) => v > 0).length
    const negative = [ab, bc, ac].filter((v) => v < 0).length

    if (positive === 3) return "stable"
    if (negative === 1 && positive === 2) return "mediated"
    if (negative === 2 && positive === 1) return "competitive"
    return "unstable"
  }

  private generateTriadDescription(
    characters: [string, string, string],
    pattern: string,
    ab: number,
    bc: number,
    ac: number,
  ): string {
    const [a, b, c] = characters
    const patterns: Record<string, string> = {
      stable: `${a}, ${b}, and ${c} form a stable alliance with mutual trust.`,
      unstable: `${a}, ${b}, and ${c} have a tense dynamic with conflicting interests.`,
      mediated: `${b} mediates between ${a} and ${c} who have unresolved tension.`,
      competitive: `${a}, ${b}, and ${c} are in competition, with only one positive relationship.`,
    }
    return patterns[pattern] || `Complex relationship between ${a}, ${b}, and ${c}.`
  }

  async createGroup(
    type: GroupType,
    name: string,
    members: Array<{ name: string; role: GroupRole }>,
    description: string,
    currentChapter: number,
    options: { skipDynamicsAnalysis?: boolean } = {},
  ): Promise<MultiWayRelationship> {
    let dynamics: GroupDynamics = {
      cohesion: 50,
      powerBalance: "egalitarian",
      communicationPattern: "direct",
      decisionMaking: "democratic",
      conflictLevel: 20,
      stability: 60,
    }

    let sharedGoals: string[] = []
    let sharedResources: string[] = []

    if (!options.skipDynamicsAnalysis) {
      const languageModel = await getNovelLanguageModel()

      const prompt = `Analyze this group formation and determine its dynamics.

Group: ${name}
Type: ${type}
Members: ${members.map((m) => `${m.name} (${m.role})`).join(", ")}
Description: ${description}

Output JSON:
{
  "cohesion": 0-100,
  "powerBalance": "egalitarian|hierarchical|fragmented|contested",
  "communicationPattern": "direct|hub_and_spoke|clique_based|fragmented",
  "decisionMaking": "democratic|authoritarian|consensus|chaotic",
  "conflictLevel": 0-100,
  "stability": 0-100,
  "sharedGoals": ["goal1", "goal2"],
  "sharedResources": ["resource1"]
}`

      try {
        const result = await generateText({ model: languageModel, prompt })
        const match = result.text.match(/\{[\s\S]*\}/)
        if (match) {
          const data = JSON.parse(match[0])
          dynamics = {
            cohesion: data.cohesion || 50,
            powerBalance: data.powerBalance || "egalitarian",
            communicationPattern: data.communicationPattern || "direct",
            decisionMaking: data.decisionMaking || "democratic",
            conflictLevel: data.conflictLevel || 20,
            stability: data.stability || 60,
          }
          sharedGoals = data.sharedGoals || []
          sharedResources = data.sharedResources || []
        }
      } catch (error) {
        log.warn("group_dynamics_analysis_failed", { error: String(error) })
      }
    }

    const id = `group_${type}_${Date.now()}`
    const groupMembers: GroupMember[] = members.map((m, index) => ({
      characterName: m.name,
      role: m.role,
      influence: m.role === "leader" ? 80 : m.role === "second_in_command" ? 60 : 40,
      loyalty: 50 + Math.floor(Math.random() * 30),
      joinedChapter: currentChapter,
      contributions: [],
      conflicts: [],
    }))

    const group: MultiWayRelationship = {
      id,
      type,
      name,
      description,
      members: groupMembers,
      dynamics,
      formedChapter: currentChapter,
      sharedGoals,
      sharedResources,
      secrets: [],
      history: [
        {
          chapter: currentChapter,
          event: "Group formed",
          impact: `New ${type} established with ${members.length} members`,
        },
      ],
    }

    this.groups.set(id, group)

    for (const member of groupMembers) {
      if (!this.characterGroups.has(member.characterName)) {
        this.characterGroups.set(member.characterName, new Set())
      }
      this.characterGroups.get(member.characterName)!.add(id)
    }

    log.info("group_created", { id, type, name, memberCount: members.length })
    return group
  }

  updateMemberRole(groupId: string, characterName: string, newRole: GroupRole): boolean {
    const group = this.groups.get(groupId)
    if (!group) return false

    const member = group.members.find((m) => m.characterName === characterName)
    if (!member) return false

    member.role = newRole
    member.influence = newRole === "leader" ? 80 : newRole === "second_in_command" ? 60 : 40

    this.groups.set(groupId, group)
    log.info("member_role_updated", { groupId, characterName, newRole })
    return true
  }

  addMemberToGroup(groupId: string, characterName: string, role: GroupRole, currentChapter: number): boolean {
    const group = this.groups.get(groupId)
    if (!group) return false

    if (group.members.some((m) => m.characterName === characterName)) {
      return false
    }

    const newMember: GroupMember = {
      characterName,
      role,
      influence: role === "leader" ? 80 : role === "second_in_command" ? 60 : 40,
      loyalty: 40,
      joinedChapter: currentChapter,
      contributions: [],
      conflicts: [],
    }

    group.members.push(newMember)
    group.history.push({
      chapter: currentChapter,
      event: `${characterName} joined as ${role}`,
      impact: "Group composition changed",
    })

    if (!this.characterGroups.has(characterName)) {
      this.characterGroups.set(characterName, new Set())
    }
    this.characterGroups.get(characterName)!.add(groupId)

    this.groups.set(groupId, group)
    log.info("member_added_to_group", { groupId, characterName, role })
    return true
  }

  removeMemberFromGroup(groupId: string, characterName: string, currentChapter: number): boolean {
    const group = this.groups.get(groupId)
    if (!group) return false

    const memberIndex = group.members.findIndex((m) => m.characterName === characterName)
    if (memberIndex === -1) return false

    group.members.splice(memberIndex, 1)
    group.history.push({
      chapter: currentChapter,
      event: `${characterName} left the group`,
      impact: "Group composition changed",
    })

    this.characterGroups.get(characterName)?.delete(groupId)

    this.groups.set(groupId, group)
    log.info("member_removed_from_group", { groupId, characterName })
    return true
  }

  addGroupRelationship(
    sourceGroupId: string,
    targetGroupId: string,
    type: GroupRelationship["type"],
    strength: number,
    description: string,
  ): boolean {
    const sourceGroup = this.groups.get(sourceGroupId)
    const targetGroup = this.groups.get(targetGroupId)

    if (!sourceGroup || !targetGroup) return false

    const relationship: GroupRelationship = {
      sourceGroupId,
      targetGroupId,
      type,
      strength,
      description,
    }

    if (!sourceGroup.relationships) {
      sourceGroup.relationships = []
    }
    sourceGroup.relationships.push(relationship)

    this.groups.set(sourceGroupId, sourceGroup)
    log.info("group_relationship_added", { sourceGroupId, targetGroupId, type })
    return true
  }

  dissolveGroup(groupId: string, currentChapter: number): boolean {
    const group = this.groups.get(groupId)
    if (!group) return false

    group.dissolvedChapter = currentChapter
    group.history.push({
      chapter: currentChapter,
      event: "Group dissolved",
      impact: "Group no longer active",
    })

    for (const member of group.members) {
      this.characterGroups.get(member.characterName)?.delete(groupId)
    }

    this.groups.set(groupId, group)
    log.info("group_dissolved", { groupId, chapter: currentChapter })
    return true
  }

  getGroup(groupId: string): MultiWayRelationship | undefined {
    return this.groups.get(groupId)
  }

  getGroupsForCharacter(characterName: string): MultiWayRelationship[] {
    const groupIds = this.characterGroups.get(characterName)
    if (!groupIds) return []

    return Array.from(groupIds)
      .map((id) => this.groups.get(id))
      .filter((g): g is MultiWayRelationship => g !== undefined && !g.dissolvedChapter)
  }

  getActiveGroups(): MultiWayRelationship[] {
    return Array.from(this.groups.values()).filter((g) => !g.dissolvedChapter)
  }

  getGroupsByType(type: GroupType): MultiWayRelationship[] {
    return this.getActiveGroups().filter((g) => g.type === type)
  }

  calculateGroupCohesion(groupId: string): number {
    const group = this.groups.get(groupId)
    if (!group) return 0

    return group.dynamics.cohesion
  }

  getGroupReport(): string {
    const lines: string[] = ["# Multi-Way Relationships Report\n"]

    for (const group of this.getActiveGroups()) {
      lines.push(`## ${group.name} (${group.type})`)
      lines.push(`**Description:** ${group.description}`)
      lines.push(`**Formed:** Chapter ${group.formedChapter}`)
      lines.push(`\n**Members:**`)

      for (const member of group.members) {
        lines.push(`- **${member.characterName}** (${member.role})`)
        lines.push(`  - Influence: ${member.influence}%, Loyalty: ${member.loyalty}%`)
        lines.push(`  - Joined: Chapter ${member.joinedChapter}`)
      }

      lines.push(`\n**Dynamics:**`)
      lines.push(`- Cohesion: ${group.dynamics.cohesion}%`)
      lines.push(`- Power Balance: ${group.dynamics.powerBalance}`)
      lines.push(`- Decision Making: ${group.dynamics.decisionMaking}`)
      lines.push(`- Conflict Level: ${group.dynamics.conflictLevel}%`)
      lines.push(`- Stability: ${group.dynamics.stability}%`)

      if (group.sharedGoals.length > 0) {
        lines.push(`\n**Shared Goals:**`)
        for (const goal of group.sharedGoals) {
          lines.push(`- ${goal}`)
        }
      }

      if (group.relationships && group.relationships.length > 0) {
        lines.push(`\n**Group Relationships:**`)
        for (const rel of group.relationships) {
          const targetGroup = this.groups.get(rel.targetGroupId)
          if (targetGroup) {
            lines.push(`- ${targetGroup.name}: ${rel.type} (${rel.strength}%)`)
          }
        }
      }

      lines.push("")
    }

    return lines.join("\n")
  }

  clear(): void {
    this.groups.clear()
    this.characterGroups.clear()
    log.info("multiway_relationships_cleared")
  }
}

export const multiWayRelationshipManager = new MultiWayRelationshipManager()
