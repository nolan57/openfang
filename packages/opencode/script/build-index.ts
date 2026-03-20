import { glob } from "glob"
import { readFile } from "fs/promises"
import { resolve } from "path"
import { Memory } from "../src/memory"
import { KnowledgeGraph } from "../src/learning/knowledge-graph"
import { getSharedVectorStore } from "../src/learning/vector-store"

const PROJECT_DIR = "/Users/lpcw/Documents/opencode/packages/opencode"

async function main() {
  console.log("=".repeat(60))
  console.log("项目知识图谱和向量索引重建")
  console.log("=".repeat(60))

  console.log("\n[1/5] 初始化 Memory 服务...")
  await Memory.init()

  const srcDir = resolve(PROJECT_DIR, "src")
  console.log("  源目录:", srcDir)

  console.log("\n[2/5] 初始化 VectorStore...")
  const vs = await getSharedVectorStore()
  console.log("  VectorStore 已初始化")

  console.log("\n[3/5] 扫描 TypeScript 文件...")
  const files = await glob("**/*.ts", {
    cwd: srcDir,
    ignore: ["**/node_modules/**", "**/dist/**"],
  })
  console.log(`  找到 ${files.length} 个 TypeScript 文件`)

  console.log("\n[4/5] 读取文件内容...")
  const fileContents: Array<{ path: string; content: string }> = []
  for (const file of files) {
    const content = await readFile(resolve(srcDir, file), "utf-8")
    fileContents.push({ path: `src/${file}`, content })
  }
  console.log(`  已读取 ${fileContents.length} 个文件`)

  console.log("\n[5/5] 建立知识图谱和向量索引...")
  console.log("  这可能需要几分钟...")

  const result = await Memory.indexProject({
    files: fileContents,
    clearExisting: true,
  })

  console.log(`\n  实体添加: ${result.entitiesAdded}`)
  console.log(`  关系添加: ${result.relationsAdded}`)

  const kg = new KnowledgeGraph()
  const stats = await kg.getStats()
  console.log(`\n  知识图谱统计:`)
  console.log(`    节点: ${stats.nodes}`)
  console.log(`    边: ${stats.edges}`)
  console.log(`    按类型:`, stats.byType)

  console.log("\n" + "=".repeat(60))
  console.log("✅ 索引完成!")
  console.log("=".repeat(60))
}

main().catch(console.error)
