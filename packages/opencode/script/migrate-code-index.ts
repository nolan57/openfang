import { Database } from "../src/storage/db"
import { vector_memory } from "../src/learning/learning.sql"
import { readFileSync } from "fs"
import { join } from "path"

const DIMENSIONS = 384
const MODEL = "simple"

interface VectorEntry {
  node_id: string
  entity_title: string
  node_type: string
  vector_type: string
  content_text: string
  metadata: Record<string, unknown>
}

interface JsonFormat {
  format_version: string
  vector_entries: VectorEntry[]
}

function simpleEmbedding(text: string): Float32Array {
  const words = text.toLowerCase().split(/\W+/)
  const wordFreq: Record<string, number> = {}

  for (const word of words) {
    if (word.length > 2) {
      wordFreq[word] = (wordFreq[word] || 0) + 1
    }
  }

  const hash1 = hashString(text)
  const hash2 = hashString(text.split("").reverse().join(""))

  const embedding: number[] = []
  for (let i = 0; i < DIMENSIONS; i++) {
    const posHash = hashString(text + i)
    const freqSum = Object.values(wordFreq).reduce((a, b) => a + b, 0)

    const value =
      Math.sin(hash1 * (i + 1) * 0.1) * 0.3 +
      Math.cos(hash2 * (i + 1) * 0.1) * 0.3 +
      (freqSum > 0
        ? (Object.entries(wordFreq).reduce(
            (sum, [w, f]) => sum + Math.sin(hashString(w) * (i + 1) * 0.01) * f,
            0,
          ) /
            freqSum) *
          0.4
        : 0)

    embedding.push(Math.tanh(value))
  }

  return new Float32Array(normalize(embedding))
}

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash = hash & hash
  }
  return Math.abs(hash)
}

function normalize(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
  if (magnitude === 0) return vec
  return vec.map((v) => v / magnitude)
}

function importVectorEntries(entries: VectorEntry[]): { imported: number; skipped: number; errors: number } {
  const sqlite = Database.raw()
  const now = Date.now()
  
  let imported = 0
  let skipped = 0
  let errors = 0

  const checkStmt = sqlite.prepare("SELECT id FROM vector_memory WHERE id = ?")
  const insertStmt = sqlite.prepare(`
    INSERT INTO vector_memory (id, node_type, node_id, entity_title, vector_type, embedding, model, dimensions, metadata, time_created, time_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const entry of entries) {
    try {
      const existing = checkStmt.get(entry.node_id)
      if (existing) {
        skipped++
        continue
      }

      const embedding = simpleEmbedding(`${entry.entity_title} ${entry.content_text}`)
      const embeddingJson = JSON.stringify(Array.from(embedding))
      const metadataJson = entry.metadata ? JSON.stringify(entry.metadata) : null

      insertStmt.run(
        entry.node_id,
        entry.node_type,
        entry.node_id,
        entry.entity_title,
        entry.vector_type,
        embeddingJson,
        MODEL,
        embedding.length,
        metadataJson,
        now,
        now,
      )

      imported++
    } catch (error) {
      console.error(`Error importing ${entry.node_id}:`, error)
      errors++
    }
  }

  return { imported, skipped, errors }
}

function processFile(filePath: string): { imported: number; skipped: number; errors: number; entries: number } {
  console.log(`\nProcessing: ${filePath}`)
  
  const fullPath = join(process.cwd(), filePath)
  
  let jsonContent: string
  try {
    jsonContent = readFileSync(fullPath, "utf-8")
  } catch (error) {
    console.error(`Failed to read file: ${filePath}`)
    return { imported: 0, skipped: 0, errors: 1, entries: 0 }
  }

  let data: JsonFormat
  try {
    data = JSON.parse(jsonContent)
  } catch (error) {
    console.error(`Failed to parse JSON: ${filePath}`)
    return { imported: 0, skipped: 0, errors: 1, entries: 0 }
  }

  if (!data.vector_entries || !Array.isArray(data.vector_entries)) {
    console.error(`Invalid format: missing vector_entries array`)
    return { imported: 0, skipped: 0, errors: 1, entries: 0 }
  }

  console.log(`Found ${data.vector_entries.length} entries`)
  const result = importVectorEntries(data.vector_entries)
  
  console.log(`  Imported: ${result.imported}`)
  console.log(`  Skipped: ${result.skipped}`)
  console.log(`  Errors: ${result.errors}`)
  
  return { ...result, entries: data.vector_entries.length }
}

function main() {
  const args = process.argv.slice(2)
  
  // Skip '--' if present
  const filePaths = args[0] === "--" ? args.slice(1) : args

  if (filePaths.length === 0) {
    console.log("=== Code Index Vector Migration ===\n")
    console.log("Usage: bun run script/migrate-code-index.ts -- <json-file> [additional-files...]")
    console.log("\nExample:")
    console.log("  bun run script/migrate-code-index.ts -- code-index-vector-entries.json")
    console.log("  bun run script/migrate-code-index.ts -- data/vectors1.json data/vectors2.json")
    console.log("\nJSON format:")
    console.log('  { "format_version": "1.0", "vector_entries": [...] }')
    process.exit(0)
  }

  console.log("=== Code Index Vector Migration ===\n")
  console.log(`Processing ${filePaths.length} file(s)\n`)

  console.log("Initializing database...")
  Database.Client()
  console.log("Database ready\n")

  let totalImported = 0
  let totalSkipped = 0
  let totalErrors = 0
  let totalEntries = 0

  for (const filePath of filePaths) {
    const result = processFile(filePath)
    totalImported += result.imported
    totalSkipped += result.skipped
    totalErrors += result.errors
    totalEntries += result.entries
  }

  console.log("\n=== Migration Complete ===")
  console.log(`Total files processed: ${filePaths.length}`)
  console.log(`Total entries found: ${totalEntries}`)
  console.log(`Imported: ${totalImported}`)
  console.log(`Skipped (already exists): ${totalSkipped}`)
  console.log(`Errors: ${totalErrors}`)

  const sqlite = Database.raw()
  const total = sqlite.prepare("SELECT COUNT(*) as cnt FROM vector_memory").get() as { cnt: number }
  console.log(`\nTotal vectors in database: ${total.cnt}`)
}

main()