import { describe, test, expect, beforeEach } from "bun:test"
import { MultiWayRelationshipManager } from "../multiway-relationships"

describe("MultiWayRelationshipManager", () => {
  let manager: MultiWayRelationshipManager

  beforeEach(() => {
    manager = new MultiWayRelationshipManager()
  })

  const createCharacters = (names: string[]): Record<string, any> => {
    const chars: Record<string, any> = {}
    for (const name of names) {
      chars[name] = { name, stress: 0, status: "active" }
    }
    return chars
  }

  const createRelationships = (pairs: Array<[string, string, number]>): Record<string, any> => {
    const rels: Record<string, any> = {}
    for (const [a, b, trust] of pairs) {
      rels[`${a}-${b}`] = {
        trust,
        hostility: trust < 0 ? Math.abs(trust) : 0,
        dominance: 0,
        friendliness: trust > 0 ? trust : 0,
      }
    }
    return rels
  }

  test("detectTriads identifies stable triad", async () => {
    const characters = createCharacters(["Alice", "Bob", "Charlie"])
    const relationships = createRelationships([
      ["Alice", "Bob", 60],
      ["Bob", "Charlie", 70],
      ["Alice", "Charlie", 65],
    ])

    const triads = await manager.detectTriads(characters, relationships, 1)

    expect(triads.length).toBeGreaterThan(0)
    expect(triads[0].pattern).toBe("stable")
  })

  test("detectTriads identifies unstable triad", async () => {
    const characters = createCharacters(["Alice", "Bob", "Charlie"])
    const relationships = createRelationships([
      ["Alice", "Bob", -60],
      ["Bob", "Charlie", -70],
      ["Alice", "Charlie", -65],
    ])

    const triads = await manager.detectTriads(characters, relationships, 1)

    expect(triads.length).toBeGreaterThan(0)
  })

  test("createGroup stores group", async () => {
    const group = await manager.createGroup(
      "triad",
      "Test Alliance",
      [
        { name: "Alice", role: "leader" },
        { name: "Bob", role: "member" },
        { name: "Charlie", role: "member" },
      ],
      "A test alliance",
      1,
      { skipDynamicsAnalysis: true },
    )

    expect(group.id).toBeDefined()
    expect(group.name).toBe("Test Alliance")
    expect(group.members.length).toBe(3)
  })

  test("getGroup retrieves group", async () => {
    const created = await manager.createGroup(
      "faction",
      "Test Faction",
      [{ name: "Alice", role: "leader" }],
      "Test",
      1,
      { skipDynamicsAnalysis: true },
    )

    const retrieved = manager.getGroup(created.id)
    expect(retrieved).toBeDefined()
    expect(retrieved?.name).toBe("Test Faction")
  })

  test("getGroupsForCharacter returns character's groups", async () => {
    await manager.createGroup("faction", "Group 1", [{ name: "Alice", role: "leader" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    await manager.createGroup("coalition", "Group 2", [{ name: "Alice", role: "member" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    const groups = manager.getGroupsForCharacter("Alice")
    expect(groups.length).toBe(2)
  })

  test("addMemberToGroup adds member", async () => {
    const group = await manager.createGroup(
      "triad",
      "Test",
      [
        { name: "Alice", role: "leader" },
        { name: "Bob", role: "member" },
      ],
      "Test",
      1,
      { skipDynamicsAnalysis: true },
    )

    const added = manager.addMemberToGroup(group.id, "Charlie", "newcomer", 2)
    expect(added).toBe(true)

    const updated = manager.getGroup(group.id)
    expect(updated?.members.length).toBe(3)
  })

  test("removeMemberFromGroup removes member", async () => {
    const group = await manager.createGroup("triad", "Test", [{ name: "Alice", role: "leader" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    manager.addMemberToGroup(group.id, "Bob", "member", 1)
    const removed = manager.removeMemberFromGroup(group.id, "Bob", 2)

    expect(removed).toBe(true)

    const updated = manager.getGroup(group.id)
    expect(updated?.members.length).toBe(1)
  })

  test("updateMemberRole changes role", async () => {
    const group = await manager.createGroup("faction", "Test", [{ name: "Alice", role: "member" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    const updated = manager.updateMemberRole(group.id, "Alice", "leader")
    expect(updated).toBe(true)

    const retrieved = manager.getGroup(group.id)
    const member = retrieved?.members.find((m) => m.characterName === "Alice")
    expect(member?.role).toBe("leader")
  })

  test("addGroupRelationship creates relationship", async () => {
    const group1 = await manager.createGroup("faction", "Faction A", [{ name: "Alice", role: "leader" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    const group2 = await manager.createGroup("faction", "Faction B", [{ name: "Bob", role: "leader" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    const added = manager.addGroupRelationship(group1.id, group2.id, "rivalry", 70, "Long-standing rivalry")

    expect(added).toBe(true)

    const retrieved = manager.getGroup(group1.id)
    expect(retrieved?.relationships?.length).toBe(1)
  })

  test("dissolveGroup marks group as dissolved", async () => {
    const group = await manager.createGroup("coalition", "Test", [{ name: "Alice", role: "leader" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    const dissolved = manager.dissolveGroup(group.id, 5)
    expect(dissolved).toBe(true)

    const retrieved = manager.getGroup(group.id)
    expect(retrieved?.dissolvedChapter).toBe(5)
  })

  test("getActiveGroups excludes dissolved groups", async () => {
    const group = await manager.createGroup("faction", "Test", [{ name: "Alice", role: "leader" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    manager.dissolveGroup(group.id, 2)

    const active = manager.getActiveGroups()
    expect(active.length).toBe(0)
  })

  test("getGroupReport generates report", async () => {
    await manager.createGroup("faction", "Test Faction", [{ name: "Alice", role: "leader" }], "A test faction", 1, {
      skipDynamicsAnalysis: true,
    })

    const report = manager.getGroupReport()
    expect(report).toContain("Multi-Way Relationships Report")
    expect(report).toContain("Test Faction")
  })

  test("getGroup retrieves group", async () => {
    const created = await manager.createGroup(
      "faction",
      "Test Faction",
      [{ name: "Alice", role: "leader" }],
      "Test",
      1,
      { skipDynamicsAnalysis: true },
    )

    const retrieved = manager.getGroup(created.id)
    expect(retrieved).toBeDefined()
    expect(retrieved?.name).toBe("Test Faction")
  })

  test("getGroupsForCharacter returns character's groups", async () => {
    await manager.createGroup("faction", "Group 1", [{ name: "Alice", role: "leader" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    await manager.createGroup("coalition", "Group 2", [{ name: "Alice", role: "member" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    const groups = manager.getGroupsForCharacter("Alice")
    expect(groups.length).toBe(2)
  })

  test("addMemberToGroup adds member", async () => {
    const group = await manager.createGroup(
      "triad",
      "Test",
      [
        { name: "Alice", role: "leader" },
        { name: "Bob", role: "member" },
      ],
      "Test",
      1,
      { skipDynamicsAnalysis: true },
    )

    const added = manager.addMemberToGroup(group.id, "Charlie", "newcomer", 2)
    expect(added).toBe(true)

    const updated = manager.getGroup(group.id)
    expect(updated?.members.length).toBe(3)
  })

  test("removeMemberFromGroup removes member", async () => {
    const group = await manager.createGroup("triad", "Test", [{ name: "Alice", role: "leader" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    manager.addMemberToGroup(group.id, "Bob", "member", 1)
    const removed = manager.removeMemberFromGroup(group.id, "Bob", 2)

    expect(removed).toBe(true)

    const updated = manager.getGroup(group.id)
    expect(updated?.members.length).toBe(1)
  })

  test("updateMemberRole changes role", async () => {
    const group = await manager.createGroup("faction", "Test", [{ name: "Alice", role: "member" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    const updated = manager.updateMemberRole(group.id, "Alice", "leader")
    expect(updated).toBe(true)

    const retrieved = manager.getGroup(group.id)
    const member = retrieved?.members.find((m) => m.characterName === "Alice")
    expect(member?.role).toBe("leader")
  })

  test("addGroupRelationship creates relationship", async () => {
    const group1 = await manager.createGroup("faction", "Faction A", [{ name: "Alice", role: "leader" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    const group2 = await manager.createGroup("faction", "Faction B", [{ name: "Bob", role: "leader" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    const added = manager.addGroupRelationship(group1.id, group2.id, "rivalry", 70, "Long-standing rivalry")

    expect(added).toBe(true)

    const retrieved = manager.getGroup(group1.id)
    expect(retrieved?.relationships?.length).toBe(1)
  })

  test("dissolveGroup marks group as dissolved", async () => {
    const group = await manager.createGroup("coalition", "Test", [{ name: "Alice", role: "leader" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    const dissolved = manager.dissolveGroup(group.id, 5)
    expect(dissolved).toBe(true)

    const retrieved = manager.getGroup(group.id)
    expect(retrieved?.dissolvedChapter).toBe(5)
  })

  test("getActiveGroups excludes dissolved groups", async () => {
    const group = await manager.createGroup("faction", "Test", [{ name: "Alice", role: "leader" }], "Test", 1, {
      skipDynamicsAnalysis: true,
    })

    manager.dissolveGroup(group.id, 2)

    const active = manager.getActiveGroups()
    expect(active.length).toBe(0)
  })

  test("getGroupReport generates report", async () => {
    await manager.createGroup("faction", "Test Faction", [{ name: "Alice", role: "leader" }], "A test faction", 1, {
      skipDynamicsAnalysis: true,
    })

    const report = manager.getGroupReport()
    expect(report).toContain("Multi-Way Relationships Report")
    expect(report).toContain("Test Faction")
  })
})
