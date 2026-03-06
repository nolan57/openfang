// Direct test of db.ts loading
import { Database } from "./src/storage/db"

console.error("=== Direct DB test START ===")

try {
  const db = Database.Client
  console.error("Database.Client obtained:", typeof db)

  // Try to use it
  const raw = Database.raw()
  console.error("Database raw connection:", typeof raw)

  // Try a simple query
  raw.exec("SELECT 1")
  console.error("Simple query works!")

  console.error("=== Direct DB test PASSED ===")
} catch (e) {
  console.error("Error:", e)
  console.error("=== Direct DB test FAILED ===")
}
