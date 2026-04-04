import { z } from "zod"
import { Log } from "../util/log"
import { resolve, dirname } from "path"
import { mkdir } from "fs/promises"
import { getProceduralWorldDbPath } from "./novel-config"
import { callLLMJson, type LLMJsonCallOptions } from "./llm-wrapper"

const log = Log.create({ service: "procedural-world" })

// Lazy-initialized database path
let WORLD_DB_PATH: string | null = null

function getDbPath(): string {
  if (!WORLD_DB_PATH) {
    WORLD_DB_PATH = getProceduralWorldDbPath()
  }
  return WORLD_DB_PATH
}

export const RegionTypeSchema = z.enum([
  "city",
  "town",
  "village",
  "wilderness",
  "dungeon",
  "landmark",
  "ruin",
  "fortress",
  "temple",
  "market",
])

export const RegionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: RegionTypeSchema,
  description: z.string(),
  coordinates: z.object({
    x: z.number(),
    y: z.number(),
  }),
  size: z.number().min(1).max(100),
  population: z.number().min(0).optional(),
  factions: z.array(z.string()).optional(),
  resources: z.array(z.string()).optional(),
  dangers: z.array(z.string()).optional(),
  connections: z.array(z.string()).optional(),
  discovered: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type RegionType = z.infer<typeof RegionTypeSchema>
export type Region = z.infer<typeof RegionSchema>

// ============================================================================
// Ecology Data Models (opt-in via enableEcology config)
// ============================================================================

export const EcoEntitySchema = z.object({
  name: z.string(),
  adaptation: z.string(),
  role: z.enum(["Producer", "Consumer", "Apex Predator", "Herbivore", "Decomposer", "Omnivore"]),
  resourceValue: z.array(z.string()),
})

export type EcoEntity = z.infer<typeof EcoEntitySchema>

export const EcologicalProfileSchema = z.object({
  // Physical skeleton (math-based)
  climateZone: z.string(),
  temperature: z.number(),
  precipitation: z.number(),
  elevation: z.number(),
  humidityFactor: z.number(),
  // LLM-generated ecology (only when enableEcology = true)
  microClimate: z.string().optional(),
  uniqueFlora: z.array(EcoEntitySchema).optional(),
  uniqueFauna: z.array(EcoEntitySchema).optional(),
  ecologicalThreats: z.array(z.string()).optional(),
  // Narrative hooks generated from ecology
  narrativeHooks: z.array(z.string()).optional(),
})

export type EcologicalProfile = z.infer<typeof EcologicalProfileSchema>

export interface WorldGenerationConfig {
  seed: number
  mapSize: number
  regionCount: number
  enableHistory: boolean
  enableEcology: boolean
}

const DEFAULT_CONFIG: WorldGenerationConfig = {
  seed: Date.now(),
  mapSize: 100,
  regionCount: 20,
  enableHistory: true,
  enableEcology: false,
}

export class ProceduralWorldGenerator {
  private regions: Map<string, Region> = new Map()
  private config: WorldGenerationConfig
  private seededRandom: () => number

  constructor(config: Partial<WorldGenerationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.seededRandom = this.createSeededRandom(this.config.seed)
  }

  private createSeededRandom(seed: number): () => number {
    return () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(this.seededRandom() * (max - min + 1)) + min
  }

  private randomChoice<T>(array: T[]): T {
    return array[this.randomInt(0, array.length - 1)]
  }

  async generateWorld(initialPrompt: string): Promise<{
    regions: Region[]
    history: string[]
    conflicts: string[]
  }> {
    log.info("generating_procedural_world", {
      seed: this.config.seed,
      mapSize: this.config.mapSize,
      regionCount: this.config.regionCount,
    })

    const regions: Region[] = []
    const history: string[] = []
    const conflicts: string[] = []

    // Generate regions
    for (let i = 0; i < this.config.regionCount; i++) {
      const region = await this.generateRegion(i)
      regions.push(region)
      this.regions.set(region.id, region)
    }

    // Generate connections between regions
    this.generateConnections(regions)

    // Generate ecology for all regions (physical always, LLM opt-in)
    this.generateEcology(regions)

    // Generate history if enabled
    if (this.config.enableHistory) {
      history.push(...this.generateWorldHistory(regions))
    }

    // Generate conflicts
    conflicts.push(...this.generateConflicts(regions))

    log.info("world_generation_complete", {
      regionCount: regions.length,
      historyEvents: history.length,
      conflicts: conflicts.length,
    })

    return { regions, history, conflicts }
  }

  private async generateRegion(index: number): Promise<Region> {
    const regionTypes: RegionType[] = [
      "city",
      "town",
      "village",
      "wilderness",
      "dungeon",
      "landmark",
      "ruin",
      "fortress",
      "temple",
      "market",
    ]

    const prefixes = [
      "North",
      "South",
      "East",
      "West",
      "Old",
      "New",
      "High",
      "Low",
      "Great",
      "Little",
      "Dark",
      "Bright",
    ]

    const roots = ["wood", "stone", "river", "mountain", "forest", "field", "vale", "peak", "haven", "gard"]

    const suffixes = ["ton", "ville", "burg", "ford", "bridge", "mouth", "hold", "watch", "spire", "crest"]

    const id = `region_${index}_${Date.now()}`
    const name = `${this.randomChoice(prefixes)}${this.randomChoice(roots)}${this.randomChoice(suffixes)}`
    const type = this.randomChoice(regionTypes)

    const descriptions: Record<RegionType, string[]> = {
      city: [
        "A bustling metropolitan center with towering buildings",
        "A densely populated urban sprawl",
        "The cultural and economic hub of the region",
      ],
      town: [
        "A modest settlement with cobblestone streets",
        "A quiet community surrounded by farmland",
        "A trading post at the crossroads",
      ],
      village: [
        "A small cluster of homes and shops",
        "A rural hamlet dependent on agriculture",
        "A peaceful settlement in the countryside",
      ],
      wilderness: [
        "Untamed lands with dense forests",
        "Rolling hills and open plains",
        "Rugged terrain with hidden dangers",
      ],
      dungeon: [
        "An ancient underground complex",
        "A treacherous labyrinth filled with monsters",
        "A forgotten tomb with deadly traps",
      ],
      landmark: [
        "A distinctive natural or artificial feature",
        "A point of interest known throughout the land",
        "A site of historical significance",
      ],
      ruin: [
        "Crumbling remains of a once-great civilization",
        "Overgrown ruins reclaimed by nature",
        "A haunted site with dark secrets",
      ],
      fortress: [
        "A heavily fortified military stronghold",
        "An impregnable castle on a strategic height",
        "A garrison protecting the borderlands",
      ],
      temple: ["A sacred place of worship", "An ancient monastery with wise monks", "A holy site blessed by the gods"],
      market: [
        "A vibrant bazaar with exotic goods",
        "A trading hub where merchants gather",
        "A bustling marketplace day and night",
      ],
    }

    return {
      id,
      name,
      type,
      description: this.randomChoice(descriptions[type]),
      coordinates: {
        x: this.randomInt(0, this.config.mapSize),
        y: this.randomInt(0, this.config.mapSize),
      },
      size: this.randomInt(1, 100),
      population:
        type === "city"
          ? this.randomInt(50000, 500000)
          : type === "town"
            ? this.randomInt(5000, 50000)
            : type === "village"
              ? this.randomInt(100, 5000)
              : undefined,
      factions: [],
      resources: this.generateResources(type),
      dangers: this.generateDangers(type),
      discovered: Date.now(),
      metadata: {
        climate: this.randomChoice(["temperate", "tropical", "arid", "cold", "mystical"]),
        terrain: this.randomChoice(["plains", "hills", "mountains", "forest", "coastal"]),
      },
    }
  }

  private generateResources(type: RegionType): string[] {
    const resourcePool: Record<RegionType, string[]> = {
      city: ["gold", "silver", "manuscripts", "artifacts", "trade goods"],
      town: ["grain", "livestock", "timber", "iron", "cloth"],
      village: ["grain", "vegetables", "wool", "herbs"],
      wilderness: ["timber", "game", "herbs", "rare minerals"],
      dungeon: ["ancient treasures", "magical items", "relics"],
      landmark: ["tourism", "pilgrims", "rare materials"],
      ruin: ["ancient artifacts", "lost knowledge", "cursed items"],
      fortress: ["weapons", "armor", "supplies"],
      temple: ["holy relics", "sacred texts", "blessings"],
      market: ["exotic goods", "rare items", "information"],
    }

    const pool = resourcePool[type] || []
    const count = this.randomInt(1, 3)
    const result: string[] = []

    for (let i = 0; i < count; i++) {
      const resource = this.randomChoice(pool)
      if (!result.includes(resource)) {
        result.push(resource)
      }
    }

    return result
  }

  private generateDangers(type: RegionType): string[] {
    const dangerPool: Record<RegionType, string[]> = {
      city: ["thieves", "corruption", "political intrigue"],
      town: ["bandits", "disease", "economic troubles"],
      village: ["raiders", "wild beasts", "crop failure"],
      wilderness: ["monsters", "bandits", "harsh weather"],
      dungeon: ["traps", "monsters", "curses"],
      landmark: ["guardians", "tests", "rivals"],
      ruin: ["undead", "traps", "curses"],
      fortress: ["siege", "betrayal", "shortages"],
      temple: ["heretics", "demons", "trials"],
      market: ["scams", "thieves", "rival merchants"],
    }

    const pool = dangerPool[type] || []
    const count = this.randomInt(0, 2)
    const result: string[] = []

    for (let i = 0; i < count; i++) {
      const danger = this.randomChoice(pool)
      if (!result.includes(danger)) {
        result.push(danger)
      }
    }

    return result
  }

  private generateConnections(regions: Region[]): void {
    // Simple connection: each region connects to 1-3 nearest regions
    for (const region of regions) {
      const connections = this.findNearestRegions(region, regions, this.randomInt(1, 3))
      region.connections = connections.map((r) => r.id)
    }
  }

  private findNearestRegions(region: Region, allRegions: Region[], count: number): Region[] {
    return allRegions
      .filter((r) => r.id !== region.id)
      .map((r) => ({
        region: r,
        distance: Math.sqrt(
          Math.pow(r.coordinates.x - region.coordinates.x, 2) + Math.pow(r.coordinates.y - region.coordinates.y, 2),
        ),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, count)
      .map((r) => r.region)
  }

  private generateWorldHistory(regions: Region[]): string[] {
    const history: string[] = []
    const eras = ["Age of Creation", "Age of Legends", "Age of Empires", "Age of Decline", "Current Age"]

    for (let i = 0; i < 5; i++) {
      const era = eras[i]
      const events = this.generateEraEvents(era, regions)
      history.push(...events)
    }

    return history
  }

  private generateEraEvents(era: string, regions: Region[]): string[] {
    const eventTemplates = [
      "{region} was founded in {era}",
      "The kingdom of {region} rose to power in {era}",
      "{region} fell to invaders during {era}",
      "The great war of {era} devastated {region}",
      "{region} became a major trade hub in {era}",
      "A plague struck {region} during {era}",
      "The mage council was established in {region} in {era}",
      "{region} discovered ancient ruins in {era}",
    ]

    const events: string[] = []
    const count = this.randomInt(2, 5)

    for (let i = 0; i < count; i++) {
      const template = this.randomChoice(eventTemplates)
      const region = this.randomChoice(regions)
      const event = template.replace("{region}", region.name).replace("{era}", era)
      events.push(event)
    }

    return events
  }

  private generateConflicts(regions: Region[]): string[] {
    const conflicts: string[] = []
    const cities = regions.filter((r) => r.type === "city" || r.type === "fortress")

    if (cities.length >= 2) {
      const city1 = this.randomChoice(cities)
      const city2 = this.randomChoice(cities.filter((c) => c.id !== city1.id))

      const conflictTemplates = [
        "{region1} and {region2} are engaged in a territorial dispute",
        "{region1} and {region2} compete for control of trade routes",
        "Ancient rivalry between {region1} and {region2} threatens war",
        "{region1} accuses {region2} of harboring criminals",
        "Religious differences divide {region1} and {region2}",
      ]

      const template = this.randomChoice(conflictTemplates)
      const conflict = template.replace("{region1}", city1.name).replace("{region2}", city2.name)

      conflicts.push(conflict)
    }

    return conflicts
  }

  // ============================================================================
  // Ecology Layer (opt-in via config.enableEcology)
  // ============================================================================

  /**
   * Generate ecology data for all regions with concurrency and neighbor awareness.
   * Step 1: Calculate physical environment (math-based, always runs, serial)
   * Step 2: Generate unique ecology via LLM (concurrent, neighbor-aware, opt-in)
   * Step 3: Apply ecology impact to resources/dangers (always runs, serial)
   */
  private async generateEcology(regions: Region[]): Promise<void> {
    if (regions.length === 0) return

    log.info("generating_ecology", { regionCount: regions.length, llmEnabled: this.config.enableEcology })

    // Step 1: Physical environment calculation (serial, zero cost)
    const physicalDataMap = new Map<string, ReturnType<typeof this.calculatePhysicalEnvironment>>()
    for (const region of regions) {
      const physicalData = this.calculatePhysicalEnvironment(region)
      physicalDataMap.set(region.id, physicalData)
    }

    // Step 2: LLM ecology generation (concurrent, with neighbor awareness)
    const ecologyResults = this.config.enableEcology
      ? await this.generateEcologyConcurrent(regions, physicalDataMap)
      : new Map<string, EcologicalProfile | null>()

    // Step 3: Merge data and apply impact (serial)
    for (const region of regions) {
      const physicalData = physicalDataMap.get(region.id)!
      const ecologicalProfile = ecologyResults.get(region.id) || null

      region.metadata = {
        ...region.metadata,
        ...physicalData,
        ecology: ecologicalProfile || {
          microClimate: undefined,
          uniqueFlora: [],
          uniqueFauna: [],
          ecologicalThreats: [],
          narrativeHooks: [],
        },
      }

      this.applyEcologyImpact(region, physicalData, ecologicalProfile)
    }

    const successCount = Array.from(ecologyResults.values()).filter(Boolean).length
    log.info("ecology_generation_complete", {
      llmGenerated: this.config.enableEcology,
      successCount,
      failureCount: regions.length - successCount,
    })
  }

  /**
   * Generate ecology concurrently with batch control and neighbor awareness.
   * Uses Promise.allSettled to ensure individual failures don't crash the world.
   * Max concurrency: 5 (avoids API rate limits).
   */
  private async generateEcologyConcurrent(
    regions: Region[],
    physicalDataMap: Map<string, ReturnType<typeof this.calculatePhysicalEnvironment>>,
  ): Promise<Map<string, EcologicalProfile | null>> {
    const results = new Map<string, EcologicalProfile | null>()
    const MAX_CONCURRENCY = 5

    // Pre-compute neighbor summaries for all regions
    const neighborMap = this.buildNeighborSummaries(regions)

    // Process in batches to control concurrency
    for (let i = 0; i < regions.length; i += MAX_CONCURRENCY) {
      const batch = regions.slice(i, i + MAX_CONCURRENCY)
      const promises = batch.map(async (region) => {
        const physicalData = physicalDataMap.get(region.id)!
        const neighbors = neighborMap.get(region.id) || []
        return this.callEcologyGeneratorLLM(region, physicalData, neighbors)
      })

      const settled = await Promise.allSettled(promises)
      for (let j = 0; j < settled.length; j++) {
        const region = batch[j]
        const result = settled[j]
        if (result.status === "fulfilled") {
          results.set(region.id, result.value)
        } else {
          log.warn("ecology_generation_failed_for_region", {
            region: region.name,
            error: result.reason,
          })
          results.set(region.id, null)
        }
      }
    }

    return results
  }

  /**
   * Build lightweight neighbor summaries for all regions.
   * Each region gets 1-2 nearest neighbors with their climate zone and type.
   */
  private buildNeighborSummaries(regions: Region[]): Map<string, string[]> {
    const neighborMap = new Map<string, string[]>()

    for (const region of regions) {
      const neighbors = this.findNearestRegions(region, regions, 2)
      const summaries = neighbors.map((n) => {
        const climate = (n.metadata?.climateZone as string) || "unknown"
        return `${n.name} (${n.type}, ${climate})`
      })
      neighborMap.set(region.id, summaries)
    }

    return neighborMap
  }

  /**
   * Calculate physical environment based on region coordinates.
   * Pure math — zero LLM calls, < 1ms per region.
   */
  private calculatePhysicalEnvironment(region: Region): {
    climateZone: string
    temperature: number
    precipitation: number
    elevation: number
    humidityFactor: number
    latitudeFactor: number
    physicalFlags: { isCoastal: boolean; isMountainous: boolean }
  } {
    const { x, y } = region.coordinates
    const mapSize = this.config.mapSize

    // Latitude factor: 0 (center/temperate) → 1 (poles/polar)
    const latitudeFactor = Math.abs(y - mapSize / 2) / (mapSize / 2)
    // Longitude/humidity factor: 0 (arid) → 1 (humid)
    const humidityFactor = x / mapSize
    // Elevation: 30% chance of high elevation
    const elevation = this.seededRandom() > 0.7 ? 1 : 0

    let climateZone: string
    let temperature: number

    if (latitudeFactor > 0.8 || elevation === 1) {
      climateZone = elevation === 1 ? "Alpine" : "Polar"
      temperature = 10 - (latitudeFactor * 10)
    } else if (latitudeFactor > 0.5) {
      climateZone = "Temperate"
      temperature = 50 - (latitudeFactor * 20)
    } else {
      climateZone = "Tropical"
      temperature = 80
    }

    // Precipitation: humidity + temperature-driven evaporation
    const precipitation = Math.min(100, (humidityFactor * 50) + (temperature / 2))

    return {
      climateZone,
      temperature: Math.round(temperature),
      precipitation: Math.round(precipitation),
      elevation,
      humidityFactor: Math.round(humidityFactor * 100) / 100,
      latitudeFactor: Math.round(latitudeFactor * 100) / 100,
      physicalFlags: {
        isCoastal: x > mapSize * 0.8 || x < mapSize * 0.1,
        isMountainous: elevation === 1,
      },
    }
  }

  /**
   * Generate unique ecology data via LLM with neighbor awareness.
   * Opt-in: only runs when config.enableEcology = true.
   * Uses callLLMJson for unified calling with retry, tracing, and JSON parsing.
   */
  private async callEcologyGeneratorLLM(
    region: Region,
    physicalData: ReturnType<typeof this.calculatePhysicalEnvironment>,
    neighborSummaries: string[],
  ): Promise<EcologicalProfile | null> {
    const schemaDesc = `{
  "microClimate": "descriptive name like 'Misty Canopy' or 'Scorching Dunes'",
  "uniqueFlora": [
    { "name": "...", "adaptation": "...", "role": "Producer|Consumer|Apex Predator|Herbivore|Decomposer|Omnivore", "resourceValue": ["..."] }
  ],
  "uniqueFauna": [
    { "name": "...", "adaptation": "...", "role": "...", "resourceValue": ["..."] }
  ],
  "ecologicalThreats": ["threat1", "threat2"],
  "narrativeHooks": ["hook1: tension with neighbor", "hook2: resource conflict"]
}`

    const neighborContext =
      neighborSummaries.length > 0
        ? `\nNeighboring Regions:\n${neighborSummaries.map((n) => `  - ${n}`).join("\n")}\n\nNeighbor Compatibility Rules:\n- Ensure your ecosystem is compatible with OR forms a logical contrast to your neighbors (e.g., "arid rocky wasteland" as the edge of a "rainforest").\n- NEVER generate completely unrelated extreme environments next to each other (e.g., "polar ice field" next to "tropical jungle").\n- If a neighbor is wealthy or fertile, consider generating narrative hooks about envy, raids, or trade.`
        : ""

    const prompt = `You are a World Ecology Simulator for a Fantasy RPG.
Based on the Physical Data and neighboring regions, generate a unique ecosystem.
Do NOT use generic Earth names. Be creative but logical.${neighborContext}

Physical Data:
- Climate: ${physicalData.climateZone}
- Temperature: ${physicalData.temperature}°F
- Precipitation: ${physicalData.precipitation}/100
- Elevation: ${physicalData.elevation === 1 ? "Highland" : "Lowland"}
- Coastal: ${physicalData.physicalFlags.isCoastal ? "Yes" : "No"}

Rules:
- If Cold: Flora should be hardy, Fauna should have insulation.
- If Wet: Flora should be dense, Fauna could be amphibious.
- If Dry: Flora should be sparse, Fauna should be drought-resistant.
- Generate 2-3 Unique Flora and 2-3 Unique Fauna.
- Generate 1-3 narrative hooks based on ecology (e.g., resource disputes, migration paths, border conflicts).

Output valid JSON only.`

    try {
      const result = await callLLMJson<EcologicalProfile>({
        prompt,
        callType: "ecology_generation",
        temperature: 0.8, // Higher temperature for creative world-building
        schemaDescription: schemaDesc,
        useRetry: true,
      })

      log.info("ecology_generated_llm", {
        region: region.name,
        floraCount: result.data.uniqueFlora?.length || 0,
        faunaCount: result.data.uniqueFauna?.length || 0,
        hookCount: result.data.narrativeHooks?.length || 0,
      })
      return result.data
    } catch (error) {
      log.warn("ecology_llm_failed", { region: region.name, error: String(error) })
      return null
    }
  }

  /**
   * Apply ecology data back to region resources and dangers.
   * Creates the feedback loop: ecology → resources → story generation.
   */
  private applyEcologyImpact(
    region: Region,
    physicalData: ReturnType<typeof this.calculatePhysicalEnvironment>,
    ecologicalProfile: EcologicalProfile | null,
  ): void {
    const newResources = new Set<string>(region.resources || [])
    const newDangers = new Set<string>(region.dangers || [])

    // Impact from physical environment
    const climate = physicalData.climateZone as string
    if (climate === "Polar") {
      newResources.add("ice")
      newResources.add("frost-resistant herbs")
      if (region.type === "village" || region.type === "town") {
        newDangers.add("frostbite")
        newDangers.add("blizzard")
      }
    } else if (climate === "Tropical") {
      newResources.add("exotic fruits")
      newResources.add("medicinal plants")
      if (region.type === "village" || region.type === "town") {
        newDangers.add("insect swarm")
        newDangers.add("tropical disease")
      }
    } else if (climate === "Alpine") {
      newResources.add("rare minerals")
      newDangers.add("rockslide")
    }

    // Impact from LLM-generated ecology
    if (ecologicalProfile) {
      if (ecologicalProfile.uniqueFlora) {
        for (const plant of ecologicalProfile.uniqueFlora) {
          plant.resourceValue.forEach((v) => newResources.add(v))
        }
      }
      if (ecologicalProfile.uniqueFauna) {
        for (const animal of ecologicalProfile.uniqueFauna) {
          animal.resourceValue.forEach((v) => newResources.add(v))
        }
      }
      if (ecologicalProfile.ecologicalThreats) {
        ecologicalProfile.ecologicalThreats.forEach((t) => newDangers.add(t))
      }
      // Narrative hooks from ecology → region dangers
      if (ecologicalProfile.narrativeHooks) {
        ecologicalProfile.narrativeHooks.forEach((hook) => newDangers.add(hook))
      }
    }

    region.resources = Array.from(newResources)
    region.dangers = Array.from(newDangers)
  }

  getRegion(id: string): Region | undefined {
    return this.regions.get(id)
  }

  getRegionByName(name: string): Region | undefined {
    return Array.from(this.regions.values()).find((r) => r.name === name)
  }

  getAllRegions(): Region[] {
    return Array.from(this.regions.values())
  }

  getRegionsByType(type: RegionType): Region[] {
    return this.getAllRegions().filter((r) => r.type === type)
  }

  async discoverRegion(id: string): Promise<boolean> {
    const region = this.regions.get(id)
    if (!region) return false

    region.discovered = Date.now()
    this.regions.set(id, region)

    log.info("region_discovered", { id, name: region.name })
    return true
  }

  async addFactionToRegion(regionId: string, factionName: string): Promise<boolean> {
    const region = this.regions.get(regionId)
    if (!region) return false

    if (!region.factions) {
      region.factions = []
    }

    if (!region.factions.includes(factionName)) {
      region.factions.push(factionName)
      this.regions.set(regionId, region)

      log.info("faction_added_to_region", { regionId, factionName })
      return true
    }

    return false
  }

  getWorldSummary(): string {
    const regions = this.getAllRegions()
    const lines: string[] = [
      `# World Summary`,
      ``,
      `**Total Regions:** ${regions.length}`,
      `**Map Size:** ${this.config.mapSize}x${this.config.mapSize}`,
      `**Seed:** ${this.config.seed}`,
      ``,
      `## Regions by Type`,
    ]

    const typeCounts: Record<string, number> = {}
    for (const region of regions) {
      typeCounts[region.type] = (typeCounts[region.type] || 0) + 1
    }

    for (const [type, count] of Object.entries(typeCounts)) {
      lines.push(`- **${type}:** ${count}`)
    }

    lines.push(``, `## Major Cities`)

    const cities = this.getRegionsByType("city")
    for (const city of cities.slice(0, 5)) {
      lines.push(`- **${city.name}** (pop. ${city.population?.toLocaleString() || "unknown"})`)
    }

    return lines.join("\n")
  }

  exportToJson(): { config: WorldGenerationConfig; regions: Region[] } {
    return {
      config: this.config,
      regions: this.getAllRegions(),
    }
  }

  importFromJson(data: { config: WorldGenerationConfig; regions: Region[] }): void {
    this.config = { ...this.config, ...data.config }
    this.seededRandom = this.createSeededRandom(this.config.seed)

    for (const region of data.regions) {
      this.regions.set(region.id, region)
    }

    log.info("world_imported", { regionCount: data.regions.length })
  }

  clear(): void {
    this.regions.clear()
    log.info("procedural_world_cleared")
  }
}

export const proceduralWorldGenerator = new ProceduralWorldGenerator()
