import { describe, test, expect, beforeEach } from "bun:test"
import { ProceduralWorldGenerator } from "../procedural-world"

describe("ProceduralWorldGenerator", () => {
  let generator: ProceduralWorldGenerator

  beforeEach(() => {
    generator = new ProceduralWorldGenerator({ seed: 12345, mapSize: 100, regionCount: 10 })
  })

  test("generates world with regions", async () => {
    const result = await generator.generateWorld("Test prompt")

    expect(result.regions.length).toBe(10)
    expect(result.regions[0].id).toBeDefined()
    expect(result.regions[0].name).toBeDefined()
    expect(result.regions[0].type).toBeDefined()
  })

  test("generates world history", async () => {
    generator = new ProceduralWorldGenerator({
      seed: 12345,
      mapSize: 100,
      regionCount: 10,
      enableHistory: true,
    })

    const result = await generator.generateWorld("Test prompt")

    expect(result.history.length).toBeGreaterThan(0)
    expect(result.history[0]).toContain("Age of")
  })

  test("generates conflicts", async () => {
    const result = await generator.generateWorld("Test prompt")

    expect(result.conflicts.length).toBeGreaterThanOrEqual(0)
  })

  test("generates different regions with different seeds", async () => {
    const gen1 = new ProceduralWorldGenerator({ seed: 11111, regionCount: 5 })
    const gen2 = new ProceduralWorldGenerator({ seed: 22222, regionCount: 5 })

    const result1 = await gen1.generateWorld("Test")
    const result2 = await gen2.generateWorld("Test")

    expect(result1.regions[0].name).not.toBe(result2.regions[0].name)
  })

  test("getRegion retrieves region by id", async () => {
    const result = await generator.generateWorld("Test")
    const firstRegion = result.regions[0]

    const retrieved = generator.getRegion(firstRegion.id)

    expect(retrieved).toBeDefined()
    expect(retrieved?.name).toBe(firstRegion.name)
  })

  test("getRegionByName retrieves region", async () => {
    const result = await generator.generateWorld("Test")
    const firstRegion = result.regions[0]

    const retrieved = generator.getRegionByName(firstRegion.name)

    expect(retrieved).toBeDefined()
    expect(retrieved?.id).toBe(firstRegion.id)
  })

  test("getAllRegions returns all regions", async () => {
    await generator.generateWorld("Test")

    const regions = generator.getAllRegions()

    expect(regions.length).toBe(10)
  })

  test("getRegionsByType filters by type", async () => {
    await generator.generateWorld("Test")

    const cities = generator.getRegionsByType("city")
    const villages = generator.getRegionsByType("village")

    expect(Array.isArray(cities)).toBe(true)
    expect(Array.isArray(villages)).toBe(true)
  })

  test("discoverRegion marks region as discovered", async () => {
    const result = await generator.generateWorld("Test")
    const region = result.regions[0]
    const beforeDiscovery = region.discovered

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 1))
    const discovered = await generator.discoverRegion(region.id)

    expect(discovered).toBe(true)
    const updated = generator.getRegion(region.id)
    expect(updated?.discovered).toBeGreaterThanOrEqual(beforeDiscovery)
  })

  test("addFactionToRegion adds faction", async () => {
    const result = await generator.generateWorld("Test")
    const region = result.regions[0]

    const added = await generator.addFactionToRegion(region.id, "Test Faction")

    expect(added).toBe(true)
    const updated = generator.getRegion(region.id)
    expect(updated?.factions).toContain("Test Faction")
  })

  test("getWorldSummary generates summary", async () => {
    await generator.generateWorld("Test")

    const summary = generator.getWorldSummary()

    expect(summary).toContain("World Summary")
    expect(summary).toContain("Total Regions")
    expect(summary).toContain("Map Size")
  })

  test("exportToJson exports world data", async () => {
    await generator.generateWorld("Test")

    const exported = generator.exportToJson()

    expect(exported.config).toBeDefined()
    expect(exported.regions.length).toBe(10)
  })

  test("importFromJson imports world data", async () => {
    const result = await generator.generateWorld("Test")
    const exported = generator.exportToJson()

    generator.clear()
    const imported = generator.importFromJson(exported)

    expect(generator.getAllRegions().length).toBe(10)
  })

  test("generates region resources", async () => {
    const result = await generator.generateWorld("Test")
    const region = result.regions[0]

    expect(region.resources).toBeDefined()
    expect(Array.isArray(region.resources)).toBe(true)
  })

  test("generates region dangers", async () => {
    const result = await generator.generateWorld("Test")
    const region = result.regions[0]

    expect(region.dangers).toBeDefined()
    expect(Array.isArray(region.dangers)).toBe(true)
  })

  test("generates region connections", async () => {
    const result = await generator.generateWorld("Test")
    const region = result.regions[0]

    expect(region.connections).toBeDefined()
    expect(Array.isArray(region.connections)).toBe(true)
  })
})
