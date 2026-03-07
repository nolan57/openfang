#!/usr/bin/env bun
/**
 * 10 轮自进化测试脚本 - 使用项目默认模型
 * 基于 todos/novel.md 初始化设定
 */

import { EvolutionOrchestrator } from "./packages/opencode/src/novel/orchestrator"
import { readFile, writeFile, mkdir } from "fs/promises"
import { resolve } from "path"

const PROMPT_FILE = "todos/novel.md"
const OUTPUT_DIR = ".opencode/test-runs"
const LOOPS = 10

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

async function runTest() {
  console.log("🚀 Starting 10-turn self-evolution test (CONTINUE mode)...\n")
  console.log(`📁 Working directory: ${process.cwd()}`)

  // Load prompt
  const promptPath = resolve(process.cwd(), PROMPT_FILE)
  if (!(await fileExists(promptPath))) {
    console.error(`❌ Prompt file not found: ${promptPath}`)
    return
  }

  const promptContent = await readFile(promptPath, "utf-8")
  console.log(`📄 Loaded prompt from ${PROMPT_FILE}`)

  // Initialize orchestrator (loads existing state or creates new)
  const orchestrator = new EvolutionOrchestrator()
  await orchestrator.loadState()

  const initialState = orchestrator.getState()
  const startChapter = initialState.chapterCount || 0
  console.log(`📖 Starting from Chapter: ${startChapter}`)

  // Run loops
  const results: any[] = []

  for (let i = 0; i < LOOPS; i++) {
    console.log(`\n${"=".repeat(70)}`)
    console.log(`📖 Turn ${i + 1}/${LOOPS} (Chapter ${startChapter + i + 1})`)
    console.log("=".repeat(70))

    const storySegment = await orchestrator.runNovelCycle(promptContent)
    const state = orchestrator.getState()
    const evolution = state.last_turn_evolution

    // Get character stats
    const charStats = Object.values(state.characters || {}).map((c: any) => ({
      skills: c.skills?.length || 0,
      trauma: c.trauma?.length || 0,
      stress: c.stress || 0,
    }))

    const totalSkills = charStats.reduce((sum, c) => sum + c.skills, 0)
    const totalTrauma = charStats.reduce((sum, c) => sum + c.trauma, 0)
    const avgStress = charStats.length
      ? Math.round(charStats.reduce((sum, c) => sum + c.stress, 0) / charStats.length)
      : 0

    console.log(`📊 Chapter: ${state.currentChapter}`)
    console.log(`✨ Total Skills: ${totalSkills}`)
    console.log(`💔 Total Trauma: ${totalTrauma}`)
    console.log(`😰 Avg Stress: ${avgStress}`)

    if (evolution) {
      if (evolution.highlights?.length) {
        console.log(`🌟 Highlights: ${evolution.highlights.join(" | ")}`)
      }
      if (evolution.changes?.newSkills) {
        console.log(`🆕 New Skills This Turn: ${evolution.changes.newSkills}`)
      }
      if (evolution.changes?.newTraumas) {
        console.log(`💢 New Traumas This Turn: ${evolution.changes.newTraumas}`)
      }
      if (evolution.contradictions?.length) {
        console.log(`⚠️  Contradictions: ${evolution.contradictions.join(", ")}`)
      }
    }

    const preview = storySegment.split("\n").slice(0, 3).join(" ").substring(0, 100)
    console.log(`📝 Preview: ${preview}...`)

    results.push({
      turn: i + 1,
      chapter: state.chapterCount,
      skills: totalSkills,
      traumas: totalTrauma,
      avgStress,
      highlights: evolution?.highlights || [],
      newSkills: evolution?.changes?.newSkills || 0,
      newTraumas: evolution?.changes?.newTraumas || 0,
      contradictions: evolution?.contradictions || [],
      storyPreview: preview,
    })
  }

  // Save test report
  await mkdir(resolve(OUTPUT_DIR), { recursive: true })

  const report = `# 10-Turn Self-Evolution Test Report (CONTINUE)

Generated: ${new Date().toISOString()}
Start Chapter: ${startChapter}
End Chapter: ${startChapter + LOOPS}

## Summary Table

| Turn | Chapter | Skills | Trauma | Stress | New Skills | New Trauma |
|------|---------|--------|--------|--------|------------|------------|
${results.map((r) => `| ${r.turn} | ${r.chapter} | ${r.skills} | ${r.traumas} | ${r.avgStress} | ${r.newSkills} | ${r.newTraumas} |`).join("\n")}

## Turn Details

${results
  .map(
    (r, i) => `### Turn ${r.turn} (Chapter ${r.chapter})
- **Stats**: Skills=${r.skills}, Trauma=${r.traumas}, Stress=${r.avgStress}
- **Changes**: +${r.newSkills} skills, +${r.newTraumas} trauma
- **Highlights**: ${r.highlights.join(", ") || "None"}
${r.contradictions.length ? `**⚠️ Contradictions**: ${r.contradictions.join(", ")}` : ""}

`,
  )
  .join("\n")}

## Final State Summary

- **Total Chapters**: ${results[results.length - 1].chapter}
- **Final Skills Count**: ${results[results.length - 1].skills}
- **Final Trauma Count**: ${results[results.length - 1].traumas}
- **Final Avg Stress**: ${results[results.length - 1].avgStress}
- **Total New Skills**: ${results.reduce((sum, r) => sum + r.newSkills, 0)}
- **Total New Traumas**: ${results.reduce((sum, r) => sum + r.newTraumas, 0)}

## Output Files

- Story Bible: \`.opencode/novel/state/story_bible.json\`
- Turn Summaries: \`.opencode/novel/summaries/\`
- This Report: \`.opencode/test-runs/test-report-continue.md\`
`

  const reportPath = resolve(OUTPUT_DIR, "test-report-continue.md")
  await writeFile(reportPath, report)
  console.log(`\n✅ Test report saved to: ${reportPath}`)

  // Export final state
  const state = orchestrator.getState()
  await writeFile(resolve(OUTPUT_DIR, "final-state-continue.json"), JSON.stringify(state, null, 2))
  console.log(`✅ Final state saved to: ${resolve(OUTPUT_DIR, "final-state-continue.json")}`)

  console.log("\n🎉 Test completed successfully!")
  console.log(`\n📊 Summary:`)
  console.log(`   - Ran ${LOOPS} turns`)
  console.log(`   - Started at Chapter: ${startChapter}`)
  console.log(`   - Ended at Chapter: ${state.currentChapter}`)
  console.log(`   - Characters: ${Object.keys(state.characters || {}).length}`)
  console.log(`   - Total Story Length: ${state.fullStory?.length || 0} characters`)
  console.log(`   - Total Skills Earned: ${results.reduce((sum, r) => sum + r.newSkills, 0)}`)
  console.log(`   - Total Traumas Gained: ${results.reduce((sum, r) => sum + r.newTraumas, 0)}`)
}

runTest().catch(console.error)
