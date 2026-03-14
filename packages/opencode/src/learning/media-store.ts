import { Database } from "../storage/db"
import { character_consistency, scene_graph } from "./learning.sql"
import { eq, desc } from "drizzle-orm"
import { Log } from "../util/log"
import { getSharedVectorStore, type IVectorStore } from "./vector-store"
import { EmbeddingService } from "./embedding-service"

const log = Log.create({ service: "media-store" })

export interface Character {
  id: string
  name: string
  description: string
  referenceImageUrl?: string
  attributes: Record<string, string>
  styleGuide: Record<string, unknown>
  version: number
  sceneCount: number
}

export interface Scene {
  id: string
  episode: string
  scene: string
  sequenceOrder: number
  title: string
  description: string
  characters: string[]
  location?: string
  timeOfDay?: string
  mood?: string
  cameraAngle?: string
  transitionFromPrev?: string
}

export class MediaStore {
  private vectorStore: IVectorStore | null = null

  private async getVectorStore(): Promise<IVectorStore> {
    if (!this.vectorStore) {
      this.vectorStore = await getSharedVectorStore()
    }
    return this.vectorStore
  }

  async registerCharacter(character: Omit<Character, "id" | "version" | "sceneCount">): Promise<string> {
    const id = crypto.randomUUID()
    const embedding = await this.generateCharacterEmbedding(character.name, character.description)

    Database.use((db) =>
      db.insert(character_consistency).values({
        id,
        character_name: character.name,
        character_description: character.description,
        reference_image_url: character.referenceImageUrl ?? null,
        embedding: JSON.stringify(embedding),
        attributes: JSON.stringify(character.attributes),
        style_guide: JSON.stringify(character.styleGuide),
        version: 1,
        scene_count: 0,
      }),
    )

    const vs = await this.getVectorStore()
    // Only store in vector store if embedding was generated
    if (embedding.length > 0) {
      await vs.store({
        node_type: "character",
        node_id: id,
        entity_title: character.name,
        vector_type: "character",
        metadata: {
          description: character.description,
          embeddingModel: "dashscope/text-embedding-3-small", // [ENH] Track embedding model
        },
      })
    }

    log.info("character_registered", { id, name: character.name, embeddingGenerated: embedding.length > 0 })
    return id
  }

  async getCharacter(id: string): Promise<Character | null> {
    const result = Database.use((db) =>
      db.select().from(character_consistency).where(eq(character_consistency.id, id)).get(),
    )

    if (!result) return null

    return {
      id: result.id,
      name: result.character_name,
      description: result.character_description,
      referenceImageUrl: result.reference_image_url ?? undefined,
      attributes: JSON.parse(result.attributes),
      styleGuide: JSON.parse(result.style_guide),
      version: result.version,
      sceneCount: result.scene_count,
    }
  }

  async findSimilarCharacters(name: string, limit = 5): Promise<Character[]> {
    const vs = await this.getVectorStore()
    const results = await vs.search(name, {
      limit,
      vector_type: "character",
      node_type: "character",
    })

    const characters: Character[] = []
    for (const r of results) {
      const char = await this.getCharacter(r.node_id)
      if (char) characters.push(char)
    }

    return characters
  }

  async updateCharacter(id: string, updates: Partial<Character>): Promise<void> {
    const existing = await this.getCharacter(id)
    if (!existing) return

    const newVersion = existing.version + 1
    const embedding = await this.generateCharacterEmbedding(
      updates.name ?? existing.name,
      updates.description ?? existing.description,
    )

    Database.use((db) =>
      db
        .update(character_consistency)
        .set({
          character_name: updates.name ?? existing.name,
          character_description: updates.description ?? existing.description,
          reference_image_url: updates.referenceImageUrl ?? existing.referenceImageUrl ?? null,
          embedding: JSON.stringify(embedding),
          attributes: JSON.stringify(updates.attributes ?? existing.attributes),
          style_guide: JSON.stringify(updates.styleGuide ?? existing.styleGuide),
          version: newVersion,
        })
        .where(eq(character_consistency.id, id)),
    )

    const vs = await this.getVectorStore()
    await vs.deleteById(id)
    // Only store in vector store if embedding was generated
    if (embedding.length > 0) {
      await vs.store({
        node_type: "character",
        node_id: id,
        entity_title: updates.name ?? existing.name,
        vector_type: "character",
        metadata: {
          description: updates.description ?? existing.description,
          embeddingModel: "dashscope/text-embedding-3-small", // [ENH] Track embedding model
        },
      })
    }

    log.info("character_updated", { id, version: newVersion, embeddingGenerated: embedding.length > 0 })
  }

  async incrementSceneCount(characterId: string): Promise<void> {
    const char = await this.getCharacter(characterId)
    if (!char) return

    Database.use((db) =>
      db
        .update(character_consistency)
        .set({ scene_count: char.sceneCount + 1 })
        .where(eq(character_consistency.id, characterId)),
    )
  }

  async createScene(scene: Omit<Scene, "id">): Promise<string> {
    const id = crypto.randomUUID()
    const embedding = await this.generateSceneEmbedding(scene.title, scene.description)

    Database.use((db) =>
      db.insert(scene_graph).values({
        id,
        episode: scene.episode,
        scene: scene.scene,
        sequence_order: scene.sequenceOrder,
        title: scene.title,
        description: scene.description,
        characters: JSON.stringify(scene.characters),
        location: scene.location ?? null,
        time_of_day: scene.timeOfDay ?? null,
        mood: scene.mood ?? null,
        camera_angle: scene.cameraAngle ?? null,
        transition_from_prev: scene.transitionFromPrev ?? null,
        embedding: JSON.stringify(embedding),
      }),
    )

    for (const charId of scene.characters) {
      await this.incrementSceneCount(charId)
    }

    const vs = await this.getVectorStore()
    // Only store in vector store if embedding was generated
    if (embedding.length > 0) {
      await vs.store({
        node_type: "scene",
        node_id: id,
        entity_title: `${scene.episode}-${scene.scene}: ${scene.title}`,
        vector_type: "scene",
        metadata: {
          description: scene.description,
          embeddingModel: "dashscope/text-embedding-3-small", // [ENH] Track embedding model
        },
      })
    }

    log.info("scene_created", {
      id,
      episode: scene.episode,
      scene: scene.scene,
      embeddingGenerated: embedding.length > 0,
    })
    return id
  }

  async getScene(id: string): Promise<Scene | null> {
    const result = Database.use((db) => db.select().from(scene_graph).where(eq(scene_graph.id, id)).get())

    if (!result) return null

    return {
      id: result.id,
      episode: result.episode,
      scene: result.scene,
      sequenceOrder: result.sequence_order,
      title: result.title,
      description: result.description,
      characters: JSON.parse(result.characters),
      location: result.location ?? undefined,
      timeOfDay: result.time_of_day ?? undefined,
      mood: result.mood ?? undefined,
      cameraAngle: result.camera_angle ?? undefined,
      transitionFromPrev: result.transition_from_prev ?? undefined,
    }
  }

  async findSimilarScenes(query: string, limit = 5): Promise<Scene[]> {
    const vs = await this.getVectorStore()
    const results = await vs.search(query, {
      limit,
      vector_type: "scene",
      node_type: "scene",
    })

    const scenes: Scene[] = []
    for (const r of results) {
      const scene = await this.getScene(r.node_id)
      if (scene) scenes.push(scene)
    }

    return scenes
  }

  async getEpisodeScenes(episode: string): Promise<Scene[]> {
    const results = Database.use((db) =>
      db.select().from(scene_graph).where(eq(scene_graph.episode, episode)).orderBy(scene_graph.sequence_order).all(),
    )

    return results.map((r) => ({
      id: r.id,
      episode: r.episode,
      scene: r.scene,
      sequenceOrder: r.sequence_order,
      title: r.title,
      description: r.description,
      characters: JSON.parse(r.characters),
      location: r.location ?? undefined,
      timeOfDay: r.time_of_day ?? undefined,
      mood: r.mood ?? undefined,
      cameraAngle: r.camera_angle ?? undefined,
      transitionFromPrev: r.transition_from_prev ?? undefined,
    }))
  }

  private embeddingGenerator: Awaited<ReturnType<typeof EmbeddingService.createGenerator>> | null = null

  private async getEmbeddingGenerator() {
    if (!this.embeddingGenerator) {
      try {
        this.embeddingGenerator = await EmbeddingService.createGenerator({
          modelId: "dashscope/text-embedding-v4",
          dimensions: 1536,
        })
      } catch (error) {
        log.warn("embedding_generator_unavailable", { error: String(error) })
        return null
      }
    }
    return this.embeddingGenerator
  }

  private async generateCharacterEmbedding(name: string, description: string): Promise<number[]> {
    const generator = await this.getEmbeddingGenerator()
    const text = `${name}. ${description}`

    if (generator) {
      try {
        const embedding = await generator(text, "character")
        log.debug("character_embedding_generated", { name, model: "dashscope/text-embedding-v4" })
        return Array.from(embedding)
      } catch (error) {
        log.warn("character_embedding_failed", { name, error: String(error) })
      }
    }

    // Fallback: skip vector storage but return empty array
    log.warn("character_embedding_skipped", { name, reason: "embedding_service_unavailable" })
    return []
  }

  private async generateSceneEmbedding(title: string, description: string): Promise<number[]> {
    const generator = await this.getEmbeddingGenerator()
    const text = `${title}. ${description}`

    if (generator) {
      try {
        const embedding = await generator(text, "scene")
        log.debug("scene_embedding_generated", { title, model: "dashscope/text-embedding-v4" })
        return Array.from(embedding)
      } catch (error) {
        log.warn("scene_embedding_failed", { title, error: String(error) })
      }
    }

    // Fallback: skip vector storage but return empty array
    log.warn("scene_embedding_skipped", { title, reason: "embedding_service_unavailable" })
    return []
  }

  async getStats(): Promise<{
    characters: number
    scenes: number
    episodes: number
  }> {
    const chars = Database.use((db) => db.select().from(character_consistency).all())
    const scenes = Database.use((db) => db.select().from(scene_graph).all())
    const episodes = new Set(scenes.map((s) => s.episode)).size

    return { characters: chars.length, scenes: scenes.length, episodes }
  }
}
