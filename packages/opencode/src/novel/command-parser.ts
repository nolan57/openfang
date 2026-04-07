import path from "path"
import { readFile, writeFile, readdir, stat } from "fs/promises"
import { resolve, join } from "path"
import { EvolutionOrchestrator, loadDynamicPatterns } from "./orchestrator"
import { enhancedPatternMiner } from "./pattern-miner-enhanced"
import {
  getStoryBiblePath,
  getDynamicPatternsPath,
  getSkillsPath,
  loadLayeredConfig,
  extractConfigFromPrompt,
  novelConfigManager,
} from "./novel-config"
import { Plugin } from "../plugin"
import { PluginRecovery } from "../plugin/recovery"

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Secure path resolution - prevents directory traversal attacks
 */
export function resolveSafePath(cwd: string, userInput: string): string {
  const resolved = path.resolve(cwd, userInput)
  if (!resolved.startsWith(cwd)) {
    throw new Error(" Security Error: Access outside project directory denied.")
  }
  return resolved
}

/**
 * Analyze module for improvements using the Learning Bridge
 */
async function analyzeModuleForImprovements(moduleName: string, moduleDir: string, args: string[]): Promise<void> {
  const dryRun = !args.includes("--apply")
  const modulePath = args.find((a) => a.startsWith("--path="))?.replace("--path=", "")
  const limitStr = args.find((a) => a.startsWith("--limit="))
  const limit = limitStr ? parseInt(limitStr.replace("--limit=", "")) : 10

  console.log(`\n🔍 Analyzing ${moduleName} for improvements...`)

  try {
    const engine = new EvolutionOrchestrator()
    await engine.loadState()

    const targetPath = modulePath || join(process.cwd(), moduleDir)
    const suggestions = await engine.analyzeAndSuggestImprovements(targetPath)

    if (suggestions.length === 0) {
      console.log(`✓ No improvement suggestions found for ${moduleName}`)
      return
    }

    console.log(`\n📊 ${moduleName} improvement suggestions (${suggestions.length}):`)
    console.log("─".repeat(70))

    const sortedSuggestions = suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, limit)

    for (let i = 0; i < sortedSuggestions.length; i++) {
      const s = sortedSuggestions[i]
      const confidence = (s.confidence * 100).toFixed(0)
      const confidenceIcon = s.confidence > 0.7 ? "🟢" : s.confidence > 0.5 ? "🟡" : "🔴"

      console.log(`\n${i + 1}. ${confidenceIcon} [${confidence}%] ${s.type.toUpperCase()}`)
      console.log(`   ${s.description}`)
      console.log(`   📁 ${s.targetFile}${s.targetLine ? `:${s.targetLine}` : ""}`)
    }

    console.log("\n" + "─".repeat(70))
    console.log(`\n💡 Use --apply to apply suggestions`)

    if (dryRun) {
      console.log(`\n📝 Dry run mode: suggestions not applied`)
    } else {
      console.log(`\n🔧 Applying high-confidence suggestions (confidence > 70%)...`)
      let applied = 0
      for (const s of sortedSuggestions.filter((x) => x.confidence > 0.7)) {
        const result = await engine.applyImprovement(s, false)
        if (result) applied++
      }
      console.log(`✓ Applied ${applied} improvements`)
    }
  } catch (error) {
    console.log(`× Failed to analyze ${moduleName}: ${String(error)}`)
  }
}

/**
 * Parse and execute slash commands
 */
export async function handleSlashCommand(input: string, cwd: string): Promise<void> {
  const parts = input.trim().split(/\s+/)
  const cmd = parts[0].toLowerCase()
  const args = parts.slice(1)

  switch (cmd) {
    case "/start": {
      // Parse arguments: /start [prompt-file] [--config=<config-file>] [--infer] [--visual-panels]
      let filePath: string | undefined
      let configPath: string | undefined
      let enableInference = false
      let visualPanelsEnabled = true

      for (const arg of args) {
        if (arg.startsWith("--config=")) {
          configPath = arg.slice("--config=".length)
        } else if (arg === "--infer") {
          enableInference = true
        } else if (arg === "--visual-panels") {
          visualPanelsEnabled = true
        } else if (arg === "--no-visual-panels") {
          visualPanelsEnabled = false
        } else if (!arg.startsWith("--")) {
          filePath = arg
        }
      }

      let promptContent = "Starting new creative session..."
      let promptMetadata: Record<string, any> = {}

      if (filePath) {
        const safePath = resolveSafePath(cwd, filePath)
        const rawContent = await readFile(safePath, "utf-8")

        // Extract any embedded config from front matter
        const extracted = extractConfigFromPrompt(rawContent)
        promptContent = extracted.promptContent
        promptMetadata = extracted.metadata

        console.log(` Loaded prompt from: ${filePath}`)
        if (extracted.config) {
          console.log(` Found embedded config in prompt`)
        }
        if (promptMetadata.title) {
          console.log(` Story: ${promptMetadata.title}`)
        }
      } else {
        console.log(" Starting new session (no prompt file)")
      }

      if (configPath) {
        console.log(` Using config: ${configPath}`)
      }
      if (enableInference) {
        console.log(` LLM config inference: enabled`)
      }
      console.log(` Visual panels: ${visualPanelsEnabled ? "enabled" : "disabled"}`)

      // Use layered config loading
      const configManager = await loadLayeredConfig({
        explicitConfigPath: configPath ? resolveSafePath(cwd, configPath) : undefined,
        promptContent: filePath ? promptContent : undefined,
        enableInference,
      })

      console.log(` Config source: ${configManager.getConfigSource()}`)

      const orchestrator = new EvolutionOrchestrator({ configManager, visualPanelsEnabled })
      await orchestrator.loadState()

      const result = await orchestrator.runNovelCycle(promptContent)

      console.log("\n✓ Story started!")
      console.log("Preview:", result.substring(0, 150) + "...")
      break
    }

    case "/continue": {
      console.log(" Continuing story...")

      let visualPanelsEnabled = true
      for (const arg of args) {
        if (arg === "--visual-panels") {
          visualPanelsEnabled = true
        } else if (arg === "--no-visual-panels") {
          visualPanelsEnabled = false
        }
      }

      const orchestrator = new EvolutionOrchestrator({ visualPanelsEnabled })
      await orchestrator.loadState()

      const state = orchestrator.getState()
      if (state.chapterCount === 0) {
        console.log("× No existing story. Use /start first.")
        break
      }

      const result = await orchestrator.runNovelCycle("Continue the story from the current state.")

      console.log("\n✓ Chapter generated!")
      console.log("Preview:", result.substring(0, 150) + "...")
      break
    }

    case "/inject": {
      if (!args[0]) {
        console.log("× Usage: /inject <file>")
        break
      }

      const filePath = args[0]
      const safePath = resolveSafePath(cwd, filePath)

      if (!(await fileExists(safePath))) {
        console.log(`× File not found: ${filePath}`)
        break
      }

      const content = await readFile(safePath, "utf-8")
      console.log(` Injecting context from: ${filePath}`)

      const orchestrator = new EvolutionOrchestrator()
      await orchestrator.loadState()

      // Trigger pattern analysis using EnhancedPatternMiner
      await enhancedPatternMiner.onTurn({ storySegment: content, characters: {}, chapter: 1, fullStory: content })

      // Update story state
      const state = orchestrator.getState()
      state.injectedContext = content
      await orchestrator.saveState()

      console.log("✓ Context injected and patterns updated!")
      break
    }

    case "/evolve": {
      console.log("🔍 Forcing evolution cycle...")

      await enhancedPatternMiner.initialize()
      const orchestrator = new EvolutionOrchestrator()
      await orchestrator.loadState()

      const state = orchestrator.getState()
      await enhancedPatternMiner.onTurn({
        storySegment: state.fullStory || "",
        characters: state.characters || {},
        chapter: state.chapterCount || 1,
        fullStory: state.fullStory || "",
      })

      const stats = enhancedPatternMiner.getStats()
      console.log("✓ Evolution complete!")
      console.log(`  Patterns: ${stats.patterns}, Archetypes: ${stats.archetypes}, Templates: ${stats.templates}, Motifs: ${stats.motifs}`)

      // Show updated patterns
      const updatedPatterns = await loadDynamicPatterns()
      console.log(` Total patterns: ${updatedPatterns.length}`)
      break
    }

    case "/state": {
      const target = args[0] || "world"
      const safePath = getStoryBiblePath()

      if (!(await fileExists(safePath))) {
        console.log("× No story state found. Start a story first with /start")
        break
      }

      const content = await readFile(safePath, "utf-8")
      const state = JSON.parse(content)

      if (target === "world") {
        console.log(" World State:")
        console.log(
          JSON.stringify(
            {
              chapter: state.currentChapter?.title || "N/A",
              chapterCount: state.chapterCount,
              characters: Object.keys(state.characters || {}),
              lastUpdated: state.timestamps?.lastGeneration
                ? new Date(state.timestamps.lastGeneration).toISOString()
                : "N/A",
            },
            null,
            2,
          ),
        )
      } else {
        console.log(` State for ${target}:`, JSON.stringify(state.characters?.[target], null, 2))
      }
      break
    }

    case "/lifecycle": {
      const orchestrator = new EvolutionOrchestrator()
      await orchestrator.loadState()

      const charName = args[0]
      if (charName) {
        // Show specific character's lifecycle
        const lifecycle = orchestrator.lifecycleManager.getLifecycle(charName)
        if (!lifecycle) {
          console.log(`× No lifecycle data for character: ${charName}`)
          break
        }

        console.log(`\n Character Lifecycle: ${lifecycle.characterId}`)
        console.log("═".repeat(70))
        console.log(`  Status: ${lifecycle.status}`)
        console.log(`  Life Stage: ${lifecycle.lifeStage}`)
        console.log(`  Age: ${lifecycle.currentAge.toFixed(0)} years`)
        console.log(`  Birth Chapter: ${lifecycle.birthChapter}`)
        if (lifecycle.deathChapter) {
          console.log(`  Death Chapter: ${lifecycle.deathChapter}`)
        }
        console.log(`  Total Events: ${lifecycle.lifeEvents.length}`)
        if (lifecycle.transformations.length > 0) {
          console.log(`  Transformations: ${lifecycle.transformations.length}`)
        }

        console.log("\n Life Events:")
        console.log("─".repeat(70))
        for (const event of lifecycle.lifeEvents) {
          console.log(`  Ch.${event.chapter} [${event.type}] ${event.description}`)
        }

        if (lifecycle.legacy && Object.keys(lifecycle.legacy).length > 0) {
          console.log("\n Legacy:")
          if (lifecycle.legacy.achievements?.length) {
            console.log(`  Achievements: ${lifecycle.legacy.achievements.join(", ")}`)
          }
          if (lifecycle.legacy.reputation) {
            console.log(`  Reputation: ${lifecycle.legacy.reputation}`)
          }
          if (lifecycle.legacy.children?.length) {
            console.log(`  Children: ${lifecycle.legacy.children.join(", ")}`)
          }
        }
      } else {
        // Show full lifecycle report
        console.log("\n Character Lifecycle Report")
        console.log("═".repeat(70))

        const active = orchestrator.lifecycleManager.getActiveCharacters()
        const deceased = orchestrator.lifecycleManager.getDeceasedCharacters()

        console.log(`\n Active Characters (${active.length}):`)
        console.log("─".repeat(70))
        if (active.length === 0) {
          console.log("  (No active characters)")
        } else {
          for (const lc of active.sort((a, b) => a.currentAge - b.currentAge)) {
            console.log(`  - **${lc.characterId}** (${lc.lifeStage}, age ${lc.currentAge.toFixed(0)})`)
            console.log(`    Status: ${lc.status}`)
            console.log(`    Events: ${lc.lifeEvents.length}`)
            if (lc.transformations.length > 0) {
              console.log(`    Transformations: ${lc.transformations.length}`)
            }
          }
        }

        if (deceased.length > 0) {
          console.log(`\n Deceased Characters (${deceased.length}):`)
          console.log("─".repeat(70))
          for (const lc of deceased) {
            console.log(`  - **${lc.characterId}** (died Ch.${lc.deathChapter})`)
            const deathEvent = lc.lifeEvents.find((e) => e.type === "death")
            if (deathEvent) {
              console.log(`    Cause: ${deathEvent.description}`)
            }
          }
        }

        if (active.length === 0 && deceased.length === 0) {
          console.log("  (No lifecycle data available. Generate some chapters first.)")
        }

        console.log("\n💡 Use /lifecycle <name> to view detailed lifecycle for a specific character")
      }
      break
    }

    case "/completion": {
      const orchestrator = new EvolutionOrchestrator()
      await orchestrator.loadState()
      
      const state = orchestrator.getState()
      
      // Update metrics with real data before checking
      const motifStats = orchestrator.motifManager.getStats()
      const relationshipCount = Object.keys(state.relationships || {}).length
      
      // Calculate narrative skeleton completion
      const skeleton = state.narrativeSkeleton
      let skeletonCompletion = 0
      if (skeleton && skeleton.storyLines.length > 0) {
        const totalBeats = skeleton.storyLines.reduce((sum, sl) => sum + sl.keyBeats.length, 0)
        const completedBeats = skeleton.storyLines.reduce((sum, sl) => {
          const completedIndex = sl.currentBeatIndex || 0
          return sum + Math.min(completedIndex, sl.keyBeats.length)
        }, 0)
        skeletonCompletion = totalBeats > 0 ? Math.round((completedBeats / totalBeats) * 100) : 0
      }
      
      orchestrator.detector.updateStoryMetrics({
        totalChapters: state.chapterCount,
        resolvedArcs: skeleton?.storyLines?.filter((s: any) => s.status === "resolved").length || 0,
        totalArcs: skeleton?.storyLines?.length || 1,
        thematicCoverage: Math.min(100, Math.round((motifStats.evolutions / 50) * 100)),
        resolvedConflicts: Math.floor(relationshipCount * 0.6),
        totalConflicts: relationshipCount * 2,
      })

      const report = await orchestrator.detector.checkCompletion()
      const progress = orchestrator.detector.getCriterionProgress()

      console.log(`\n📊 Story Completion Progress: ${report.completionScore.toFixed(1)}%`)
      console.log("═".repeat(60))
      
      for (const p of progress) {
        const percent = Math.min(100, Math.round(p.percentage))
        const filled = Math.round(percent / 10)
        const empty = 10 - filled
        const bar = "█".repeat(filled) + "░".repeat(empty)
        const status = p.met ? " ✅" : " ⏳"
        console.log(`│ ${p.type.padEnd(28)} [${bar}] ${percent}%${status} │`)
      }
      
      // Show narrative skeleton progress
      if (skeleton && skeletonCompletion > 0) {
        console.log("\n📖 Narrative Skeleton Progress:")
        console.log("─".repeat(60))
        console.log(`  Overall: ${skeletonCompletion}% complete`)
        for (const sl of skeleton.storyLines) {
          const slCompletion = sl.keyBeats.length > 0
            ? Math.round(((sl.currentBeatIndex || 0) / sl.keyBeats.length) * 100)
            : 0
          const statusIcon = sl.status === "resolved" ? "✅" : sl.status === "dormant" ? "⏸️" : "🟢"
          const bar = "█".repeat(Math.round(slCompletion / 10)) + "░".repeat(10 - Math.round(slCompletion / 10))
          console.log(`  ${statusIcon} ${sl.name.padEnd(20)} [${bar}] ${slCompletion}% (${sl.currentBeatIndex || 0}/${sl.keyBeats.length})`)
        }
      }
      console.log("╞══════════════════════════════════════════════════════════════╡")
      
      if (report.isComplete) {
        console.log("│ 🎉 Story is ready for conclusion!                          │")
        console.log("╘══════════════════════════════════════════════════════════════╛")
        if (report.sequelHooks && report.sequelHooks.length > 0) {
          console.log("\n🔮 Sequel Hooks:")
          for (const hook of report.sequelHooks) {
            console.log(`  - ${hook}`)
          }
        }
      } else {
        console.log(`│ ⚠️  Not ready yet. Missing: ${report.unmetCriteria.length} criteria.                │`)
        console.log("╘══════════════════════════════════════════════════════════════╛")
      }
      break
    }

    case "/branches": {
      const orchestrator = new EvolutionOrchestrator()
      await orchestrator.loadState()

      const subCommand = args[0] || "stats"

      if (subCommand === "stats") {
        // Show branch statistics
        const stats = await orchestrator.storage.getDetailedStats()
        console.log("\n Branch Statistics")
        console.log("═".repeat(70))
        console.log(`  Total Branches: ${stats.total}`)
        console.log(`  Active: ${stats.active}`)
        console.log(`  Pruned: ${stats.pruned}`)
        console.log(`  Merged: ${stats.merged}`)
        console.log(`  Selected: ${stats.selected}`)
        console.log(`\n  Quality Distribution:`)
        console.log(`    High (>=7): ${stats.qualityDistribution.high}`)
        console.log(`    Medium (4-6): ${stats.qualityDistribution.medium}`)
        console.log(`    Low (<4): ${stats.qualityDistribution.low}`)
        console.log(`\n  Chapter Range: ${stats.chapterRange.min} - ${stats.chapterRange.max}`)
        console.log(`\n  Average Evaluation Scores:`)
        console.log(`    Narrative Quality: ${stats.avgEvaluation.narrativeQuality.toFixed(1)}/10`)
        console.log(`    Tension Level: ${stats.avgEvaluation.tensionLevel.toFixed(1)}/10`)
        console.log(`    Character Development: ${stats.avgEvaluation.characterDevelopment.toFixed(1)}/10`)
        console.log(`    Plot Progression: ${stats.avgEvaluation.plotProgression.toFixed(1)}/10`)
        console.log(`    Character Growth: ${stats.avgEvaluation.characterGrowth.toFixed(1)}/10`)
        console.log(`    Risk/Reward: ${stats.avgEvaluation.riskReward.toFixed(1)}/10`)
        console.log(`    Thematic Relevance: ${stats.avgEvaluation.thematicRelevance.toFixed(1)}/10`)
      } else if (subCommand === "tree") {
        // Show branch tree structure
        const tree = await orchestrator.storage.loadBranchTree()
        console.log("\n Branch Tree Structure")
        console.log("═".repeat(70))

        let branchCount = 0
        for (const [parentId, branches] of tree) {
          const parentLabel = parentId || "Root"
          console.log(`\n  📁 ${parentLabel} (${branches.length} branches)`)
          console.log("─".repeat(70))

          for (const branch of branches.slice(0, 5)) {
            const status = branch.selected ? "✓" : branch.pruned ? "✗" : "○"
            const quality = branch.evaluation.narrativeQuality.toFixed(0)
            console.log(`    ${status} Ch.${branch.chapter} [Q:${quality}] "${branch.choiceMade.substring(0, 60)}..."`)
            branchCount++
          }

          if (branches.length > 5) {
            console.log(`    ... and ${branches.length - 5} more branches`)
            branchCount += branches.length - 5
          }
        }

        console.log(`\n  Total: ${branchCount} branches across ${tree.size} branch points`)
      } else if (subCommand === "chapter") {
        // Show branches for a specific chapter
        const chapterNum = parseInt(args[1])
        if (!chapterNum) {
          console.log("× Usage: /branches chapter <number>")
          break
        }

        const branches = await orchestrator.storage.getBranchesByChapter(chapterNum, {
          sortBy: "quality",
        })

        if (branches.length === 0) {
          console.log(`× No branches found for chapter ${chapterNum}`)
          break
        }

        console.log(`\n Branches for Chapter ${chapterNum} (${branches.length} total)`)
        console.log("═".repeat(70))

        for (let i = 0; i < branches.length; i++) {
          const branch = branches[i]
          const status = branch.selected ? "✓ SELECTED" : branch.pruned ? "✗ PRUNED" : "○ ACTIVE"
          console.log(`\n  ${i + 1}. ${status}`)
          console.log(`     Choice: "${branch.choiceMade}"`)
          console.log(`     Rationale: ${branch.choiceRationale.substring(0, 100)}...`)
          console.log(`     Quality: ${branch.evaluation.narrativeQuality}/10`)
          console.log(`     Tension: ${branch.evaluation.tensionLevel}/10`)
          console.log(`     Character Dev: ${branch.evaluation.characterDevelopment}/10`)
        }
      } else if (subCommand === "history") {
        // Show complete branch history
        const allBranches = await orchestrator.storage.loadAllBranches(false)
        const sorted = allBranches.sort((a, b) => (a.chapter || 0) - (b.chapter || 0))

        if (sorted.length === 0) {
          console.log("× No branch history found")
          break
        }

        console.log(`\n Complete Branch History (${sorted.length} branches)`)
        console.log("═".repeat(70))

        let currentChapter = 0
        for (const branch of sorted.slice(0, 50)) {
          if (branch.chapter !== currentChapter) {
            currentChapter = branch.chapter || 0
            console.log(`\n  Chapter ${currentChapter}:`)
            console.log("─".repeat(70))
          }

          const status = branch.selected ? "✓" : "○"
          console.log(`    ${status} "${branch.choiceMade.substring(0, 70)}..." [Q:${branch.evaluation.narrativeQuality.toFixed(0)}]`)
        }

        if (sorted.length > 50) {
          console.log(`\n  ... and ${sorted.length - 50} more branches (use /branches export to see all)`)
        }
      } else if (subCommand === "export") {
        // Export all branches to JSON
        const allBranches = await orchestrator.storage.exportToJson()
        const outPath = resolveSafePath(cwd, "branch_history.json")
        await writeFile(outPath, JSON.stringify(allBranches, null, 2))
        console.log(`✓ Exported ${allBranches.length} branches to: ${outPath}`)
      } else {
        console.log("× Usage: /branches <stats|tree|chapter <num>|history|export>")
        console.log("\n  stats    - Show branch statistics")
        console.log("  tree     - Show branch tree structure")
        console.log("  chapter  - Show branches for specific chapter")
        console.log("  history  - Show complete branch history")
        console.log("  export   - Export all branches to JSON")
      }
      break
    }

    case "/world": {
      const orchestrator = new EvolutionOrchestrator()
      await orchestrator.loadState()

      const subCommand = args[0] || "report"

      if (subCommand === "report") {
        const report = orchestrator.worldBible.generateReport()
        console.log(report)
      } else if (subCommand === "entities") {
        const typeFilter = args[1]
        const entities = typeFilter
          ? orchestrator.worldBible.getEntitiesByType(typeFilter as any)
          : orchestrator.worldBible.getActiveEntities()

        console.log(`\n World Entities (${entities.length}):`)
        console.log("═".repeat(70))
        for (const entity of entities) {
          console.log(`  - **${entity.name}** [${entity.type}] (Ch.${entity.chapterIntroduced})`)
          console.log(`    ${entity.description.substring(0, 80)}...`)
        }
      } else if (subCommand === "consistency") {
        console.log("× Usage: /world consistency <text> - Check text against world bible")
      } else {
        console.log("× Usage: /world <report|entities [type]|consistency>")
        console.log("\n  report      - Show world bible report")
        console.log("  entities    - List active entities (optionally filter by type)")
        console.log("  consistency - Check text for consistency")
      }
      break
    }

    case "/saga": {
      const orchestrator = new EvolutionOrchestrator()
      await orchestrator.loadState()

      const subCommand = args[0] || "report"

      if (subCommand === "report") {
        const report = orchestrator.sagaArchitect.generateReport()
        console.log(report)
      } else if (subCommand === "plan") {
        const chapters = parseInt(args[1]) || 20
        const acts = parseInt(args[2]) || 3
        const config = novelConfigManager.getConfig()
        const grandTheme = config.storyType === "theme" ? "Thematic exploration" : "Character-driven narrative"

        console.log(`\n Generating long-term saga plan for next ${chapters} chapters...`)
        const result = await orchestrator.sagaArchitect.generateLongTermPlan(
          orchestrator.getState().chapterCount,
          chapters,
          grandTheme,
          acts,
          orchestrator.getState().fullStory?.slice(-3000) || "",
        )

        console.log(`\n Plan generated:`)
        console.log(`  Volumes: ${result.plan.volumes.length}`)
        console.log(`  Chapter plans: ${result.chapterPlans.length}`)
        console.log(`  Risk factors: ${result.analysis.riskFactors.length}`)

        if (result.chapterPlans.length > 0) {
          console.log("\n Chapter Plans:")
          console.log("─".repeat(70))
          for (const plan of result.chapterPlans.slice(0, 10)) {
            console.log(`  Ch.${plan.chapterNumber}: ${plan.title} [${plan.pacing}]`)
            console.log(`    ${plan.thematicGoal}`)
          }
        }
      } else if (subCommand === "guns") {
        const active = orchestrator.sagaArchitect.getActiveChekhovsGuns()
        const overdue = orchestrator.sagaArchitect.getOverdueChekhovsGuns(
          orchestrator.getState().chapterCount,
        )

        console.log(`\n Chekhov's Guns (${active.length} active, ${overdue.length} overdue):`)
        console.log("═".repeat(70))

        if (overdue.length > 0) {
          console.log("\n ⏰ OVERDUE:")
          for (const gun of overdue) {
            console.log(`  - ${gun.description} (planted Ch.${gun.plantedChapter})`)
          }
        }

        console.log("\n Active:")
        for (const gun of active.slice(0, 15)) {
          const statusIcon = gun.status === "planted" ? "🌱" : gun.status === "developing" ? "🌿" : "✅"
          console.log(`  ${statusIcon} [${gun.status}] ${gun.description} (Ch.${gun.plantedChapter})`)
        }
      } else if (subCommand === "export") {
        const data = orchestrator.sagaArchitect.exportData()
        const outPath = resolveSafePath(cwd, "saga_plan.json")
        await writeFile(outPath, JSON.stringify(data, null, 2))
        console.log(`✓ Exported saga plan to: ${outPath}`)
      } else {
        console.log("× Usage: /saga <report|plan [chapters] [acts]|guns|export>")
        console.log("\n  report  - Show saga plan report")
        console.log("  plan    - Generate long-term plan (default: 20 chapters, 3 acts)")
        console.log("  guns    - Show Chekhov's Guns status")
        console.log("  export  - Export saga plan to JSON")
      }
      break
    }

    case "/threads": {
      const orchestrator = new EvolutionOrchestrator()
      await orchestrator.loadState()

      const multiThread = orchestrator.getMultiThreadNarrative()
      if (!multiThread) {
        console.log("× Multi-thread narrative is not initialized. Start with --multi-thread flag.")
        break
      }

      const subCommand = args[0] || "status"

      if (subCommand === "status") {
        const threads = multiThread.getActiveThreads()
        const report = multiThread.getThreadReport()
        const circuitStatus = multiThread.getCircuitBreakerStatus()

        console.log(`\n🧵 Multi-Thread Narrative Status`)
        console.log("═".repeat(70))
        console.log(`  Enabled: ${orchestrator.isMultiThreadEnabled()}`)
        console.log(`  Active Threads: ${threads.length}`)
        console.log(`  Global Chapter: ${multiThread.getGlobalChapter()}`)
        console.log("")

        if (threads.length > 0) {
          console.log("  Threads:")
          console.log("─".repeat(70))
          for (const thread of threads) {
            const statusIcon = thread.status === "active" ? "🟢" : thread.status === "merged" ? "🔀" : "⏸️"
            console.log(`  ${statusIcon} ${thread.name} (POV: ${thread.povCharacter || "none"})`)
            console.log(`     Chapter: ${thread.currentChapter} | Priority: ${thread.priority}`)
            console.log(`     Status: ${thread.status}`)
            if (thread.convergesWith) {
              console.log(`     Converges with: ${thread.convergesWith}`)
            }
            console.log("")
          }
        } else {
          console.log("  (No active threads. Create threads via narrative skeleton or CLI.)")
        }

        if (circuitStatus.failureCount > 0) {
          console.log(`\n ⚠️ Circuit Breaker: ${circuitStatus.failureCount} failures`)
        }

        console.log("\n💡 Usage: /threads <status|create <name> <pov>|advance <name>|report>")
      } else if (subCommand === "create") {
        const threadName = args[1]
        const povCharacter = args[2]
        if (!threadName || !povCharacter) {
          console.log("× Usage: /threads create <name> <pov_character>")
          break
        }

        const thread = multiThread.createThread(
          threadName,
          povCharacter,
          1,
        )
        console.log(`✓ Created thread "${thread.name}" (POV: ${povCharacter})`)
      } else if (subCommand === "advance") {
        const threadName = args[1]
        if (!threadName) {
          console.log("× Usage: /threads advance <thread_name>")
          break
        }

        const threads = multiThread.getActiveThreads()
        const thread = threads.find((t) => t.name === threadName)
        if (!thread) {
          console.log(`× Thread "${threadName}" not found.`)
          break
        }

        const advanced = await multiThread.advanceThread(thread.id, {
          summary: "CLI manual advance",
          events: [],
          characters: Object.keys(orchestrator.getState().characters),
        })
        console.log(`✓ Advanced "${thread.name}" to chapter ${advanced.currentChapter}`)
      } else if (subCommand === "report") {
        const report = multiThread.getThreadReport()
        console.log(report)
      } else {
        console.log("× Usage: /threads <status|create <name> <pov>|advance <name>|report>")
      }
      break
    }

    case "/factions": {
      const orchestrator = new EvolutionOrchestrator()
      await orchestrator.loadState()

      const state = orchestrator.getState()
      const charNames = Object.keys(state.characters || {})

      if (charNames.length < 3) {
        console.log("× Need at least 3 characters for faction analysis.")
        break
      }

      const subCommand = args[0] || "list"

      if (subCommand === "list") {
        const groups = await orchestrator.factionService.discoverActiveGroups(30, state.chapterCount)

        console.log(`\n🏛️  Active Factions/Groups (${groups.length})`)
        console.log("═".repeat(70))

        if (groups.length > 0) {
          for (const group of groups) {
            const cohesion = Math.round(group.cohesion * 100)
            const cohesionBar = "█".repeat(Math.round(cohesion / 10)) + "░".repeat(10 - Math.round(cohesion / 10))
            console.log(`\n  📁 ${group.name || "Unnamed Group"}`)
            console.log(`     Members: ${group.memberIds.join(", ")}`)
            console.log(`     Cohesion: [${cohesionBar}] ${cohesion}%`)
          }
        } else {
          console.log("  (No active factions detected. Relationships are mostly pairwise.)")
        }

        console.log("\n💡 Usage: /factions <list|triads|tension>")
      } else if (subCommand === "triads") {
        console.log(`\n🔺 Detecting relationship triads...`)
        const triads = await orchestrator.factionService.detectTriads(charNames, state.chapterCount)

        const notableTriads = triads.filter((t) => t.deviationScore > 10)
        console.log(`  Found ${triads.length} triads, ${notableTriads.length} notable.`)

        if (notableTriads.length > 0) {
          console.log("\n  Notable Triads:")
          console.log("─".repeat(70))
          for (const triad of notableTriads.slice(0, 10)) {
            const icon = triad.interventionLevel === "critical" ? "🔴" : triad.interventionLevel === "warning" ? "🟡" : "🟢"
            console.log(`  ${icon} ${triad.characters.join(" ↔ ")} (${triad.pattern})`)
            console.log(`     Deviation: ${triad.deviationScore.toFixed(0)}% | ${triad.description.substring(0, 80)}...`)
          }
        }
      } else if (subCommand === "tension") {
        const triads = await orchestrator.factionService.detectTriads(charNames, state.chapterCount)
        // Calculate average deviation as tension proxy
        const tensionLevel = triads.length > 0
          ? triads.reduce((sum, t) => sum + t.deviationScore, 0) / (triads.length * 100)
          : 0

        const tensionPercent = Math.min(100, Math.round(tensionLevel * 100))
        const tensionBar = "█".repeat(Math.round(tensionPercent / 10)) + "░".repeat(10 - Math.round(tensionPercent / 10))

        console.log(`\n🌡️  Relationship Tension Level: [${tensionBar}] ${tensionPercent}%`)

        if (tensionPercent >= 70) {
          console.log("  Status: 🔴 CRITICAL - Major conflicts imminent")
        } else if (tensionPercent >= 40) {
          console.log("  Status: 🟡 ELEVATED - Underlying tensions present")
        } else {
          console.log("  Status: 🟢 STABLE - Relationships are mostly calm")
        }
      } else {
        console.log("× Usage: /factions <list|triads|tension>")
      }
      break
    }

    case "/export": {
      const format = args[0] || "md"
      if (!["md", "json"].includes(format)) {
        console.log("× Usage: /export <md|json>")
        break
      }

      const safePath = getStoryBiblePath()
      if (!(await fileExists(safePath))) {
        console.log("× No story to export. Start with /start")
        break
      }

      const content = await readFile(safePath, "utf-8")
      const state = JSON.parse(content)

      if (format === "json") {
        const outPath = resolveSafePath(cwd, "novel_export.json")
        await writeFile(outPath, JSON.stringify(state, null, 2))
        console.log(`✓ Exported to: ${outPath}`)
      } else {
        const md = `# Novel Export

## Chapter ${state.chapterCount}: ${state.currentChapter?.title || "Untitled"}

${state.fullStory || "No content yet."}

## Characters
${Object.keys(state.characters || {}).join(", ") || "None"}

---
Exported: ${new Date().toISOString()}
`
        const outPath = resolveSafePath(cwd, "novel_export.md")
        await writeFile(outPath, md)
        console.log(`✓ Exported to: ${outPath}`)
      }
      break
    }

    case "/patterns": {
      const safePath = getDynamicPatternsPath()

      if (!(await fileExists(safePath))) {
        console.log(" No patterns discovered yet.")
        break
      }

      const content = await readFile(safePath, "utf-8")
      const data = JSON.parse(content)
      const patterns = data.patterns || []

      console.log(" Discovered Patterns:")
      if (patterns.length === 0) {
        console.log("  (No patterns discovered yet)")
      } else {
        for (const p of patterns) {
          console.log(`  - ${p.keyword} (${p.category}): ${p.description || "No description"}`)
        }
      }
      break
    }

    case "/reset": {
      console.log(" Resetting story state...")

      const safePath = getStoryBiblePath()
      await writeFile(
        safePath,
        JSON.stringify(
          {
            characters: {},
            world: {},
            relationships: {},
            currentChapter: null,
            chapterCount: 0,
            timestamps: {},
            fullStory: "",
          },
          null,
          2,
        ),
      )

      console.log("✓ Story state reset!")
      break
    }

    case "/architect": {
      console.log(" Please open http://localhost:3000/architect in your browser to start the Prompt Architect.")
      console.log(" This interactive wizard will help you create a novel_seed.md file.")
      break
    }

    case "/plugin": {
      const action = args[0] as string
      const pluginName = args[1] as string

      if (!action) {
        console.log(`
🔌 Plugin Management

Usage:
  /plugin list                    List all plugins and their status
  /plugin status [name]           Show status of a specific plugin
  /plugin restart [name]          Restart a specific plugin
  /plugin start [name]            Start a stopped plugin
  /plugin stop [name]             Stop a running plugin
`)
        break
      }

      if (action === "list" || action === "ls") {
        console.log("\n🔌 Plugin List:")
        try {
          const hooks = await Plugin.list()
          for (let i = 0; i < hooks.length; i++) {
            const hook = hooks[i]
            const status = hook["plugin.status"]
            if (status) {
              try {
                const info = await status()
                console.log(`  ${i}. ${info.status} - reconnectAttempts: ${info.metadata?.reconnectAttempts || 0}`)
              } catch {
                console.log(`  ${i}. unknown`)
              }
            } else {
              console.log(`  ${i}. (no status hook)`)
            }
          }
        } catch (error) {
          console.log(`× Failed to list plugins: ${String(error)}`)
        }
        break
      }

      if (action === "status") {
        if (!pluginName) {
          console.log("× Usage: /plugin status [name]")
          break
        }
        try {
          const hooks = await Plugin.list()
          const hook = hooks.find((h, i) => {
            const name = `plugin-${i}`
            return name === pluginName || i.toString() === pluginName
          })
          if (!hook) {
            console.log(`× Plugin not found: ${pluginName}`)
            break
          }
          const status = hook["plugin.status"]
          if (status) {
            const info = await status()
            console.log(`\n🔌 Plugin: ${pluginName}`)
            console.log(`   Status: ${info.status}`)
            console.log(`   Metadata: ${JSON.stringify(info.metadata)}`)
          } else {
            console.log(`× Plugin does not support status: ${pluginName}`)
          }
        } catch (error) {
          console.log(`× Failed to get status: ${String(error)}`)
        }
        break
      }

      if (action === "restart") {
        if (!pluginName) {
          console.log("× Usage: /plugin restart [name]")
          break
        }
        console.log(` Restarting plugin: ${pluginName}...`)
        try {
          const hooks = await Plugin.list()
          const hookIndex = parseInt(pluginName) || hooks.findIndex((h, i) => `plugin-${i}` === pluginName)
          if (hookIndex < 0 || hookIndex >= hooks.length) {
            console.log(`× Plugin not found: ${pluginName}`)
            break
          }
          const hook = hooks[hookIndex]
          const restart = hook["plugin.restart"]
          if (!restart) {
            console.log(`× Plugin does not support restart: ${pluginName}`)
            break
          }
          const result = await restart()
          if (result.success) {
            console.log(`✓ Plugin ${pluginName} restarted successfully`)
          } else {
            console.log(`× Failed to restart plugin: ${result.error}`)
          }
        } catch (error) {
          console.log(`× Failed to restart plugin: ${String(error)}`)
        }
        break
      }

      if (action === "start" || action === "stop") {
        console.log(`× Start/Stop not implemented - use /plugin restart instead`)
        break
      }

      console.log(`× Unknown action: ${action}`)
      console.log(`   Use /plugin list to see available plugins`)
      break
    }

    case "/improve-novel": {
      const dryRun = !args.includes("--apply")
      const modulePath = args.find((a) => a.startsWith("--path="))?.replace("--path=", "")
      const limitStr = args.find((a) => a.startsWith("--limit="))
      const limit = limitStr ? parseInt(limitStr.replace("--limit=", "")) : 10

      console.log("\n🔍 Analyzing novel code for improvements...")

      try {
        const engine = new EvolutionOrchestrator()
        await engine.loadState()

        const suggestions = await engine.analyzeAndSuggestImprovements(modulePath)

        if (suggestions.length === 0) {
          console.log("✓ No improvement suggestions found")
          break
        }

        console.log(`\n📊 Found ${suggestions.length} improvement suggestions:`)
        console.log("─".repeat(70))

        const sortedSuggestions = suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, limit)

        for (let i = 0; i < sortedSuggestions.length; i++) {
          const s = sortedSuggestions[i]
          const confidence = (s.confidence * 100).toFixed(0)
          const confidenceIcon = s.confidence > 0.7 ? "🟢" : s.confidence > 0.5 ? "🟡" : "🔴"

          console.log(`\n${i + 1}. ${confidenceIcon} [${confidence}%] ${s.type.toUpperCase()}`)
          console.log(`   ${s.description}`)
          console.log(`   📁 ${s.targetFile}${s.targetLine ? `:${s.targetLine}` : ""}`)
        }

        console.log("\n" + "─".repeat(70))
        console.log(`\n💡 Use --apply to apply suggestions, --limit=N to limit results`)

        if (dryRun) {
          console.log(`\n📝 Dry run mode: suggestions not applied`)
        } else {
          console.log(`\n🔧 Applying high-confidence suggestions (confidence > 70%)...`)
          let applied = 0
          for (const s of sortedSuggestions.filter((x) => x.confidence > 0.7)) {
            const result = await engine.applyImprovement(s, false)
            if (result) applied++
          }
          console.log(`✓ Applied ${applied} improvements`)
        }
      } catch (error) {
        console.log(`× Failed to analyze improvements: ${String(error)}`)
      }
      break
    }

    case "/improve-memory": {
      await analyzeModuleForImprovements("memory", "src/memory", args)
      break
    }

    case "/improve-evolution": {
      await analyzeModuleForImprovements("evolution", "src/evolution", args)
      break
    }

    case "/improve": {
      console.log(`
🔧 Module Improvement Commands:

  /improve-novel      Analyze and improve novel module
  /improve-memory     Analyze and improve memory module
  /improve-evolution  Analyze and improve evolution module

Options (apply to all):
  --apply    Apply high-confidence suggestions (>70%)
  --path=<module>  Analyze specific module path
  --limit=N  Limit to N suggestions (default: 10)

Examples:
  /improve-novel --limit=5
  /improve-memory --apply
  /improve-evolution --path=src/memory/code-analyzer.ts
`)
      break
    }

    case "/help": {
      console.log(`
📖 Available Novel Commands:

  /start [file] [--config=<path>] [--infer] [--visual-panels|--no-visual-panels]
                    Start new story
                    - file: optional prompt file path
                    - --config=<path>: explicit config file
                    - --infer: enable LLM config inference
                    - --visual-panels: enable visual panel generation (default)
                    - --no-visual-panels: disable visual panel generation
                    
  /continue [--visual-panels|--no-visual-panels]
                    Continue from last saved story
  /inject <file>    Inject context file into memory
  /evolve           Force pattern analysis and skill generation
  /state [target]   Show world state or character state
  /export <md|json> Export story to file
  /patterns         Show discovered narrative patterns
  /reset            Reset story state
  /architect        Open web-based Prompt Architect wizard
  /plugin [action] [name]
                    Plugin management:
                    - /plugin list: Show all plugins status
                    - /plugin status [name]: Show specific plugin status
                    - /plugin restart [name]: Restart a plugin

🔧 Module Improvement (Learning Bridge Phase 3):
  /improve-novel [--apply] [--path=<module>] [--limit=N]
                    Analyze novel module for improvements
  /improve-memory [--apply] [--path=<module>] [--limit=N]
                    Analyze memory module for improvements
  /improve-evolution [--apply] [--path=<module>] [--limit=N]
                    Analyze evolution module for improvements
  /improve          Show all improvement commands

Options:
  --apply    Apply high-confidence suggestions (>70%)
  --limit=N  Limit to N suggestions (default: 10)

  /help             Show this help

📋 Config Priority: --config > default file > prompt embedded > LLM infer > defaults

🔒 Security: All file paths are validated to prevent directory traversal.
`)
      break
    }

    default:
      console.log(`❓ Unknown command: ${cmd}`)
      console.log("Use /help for available commands.")
  }
}

/**
 * Check if input starts with slash command
 */
export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith("/")
}

/**
 * List available skill files
 */
export async function listSkills(cwd: string): Promise<string[]> {
  const skillsPath = getSkillsPath()

  try {
    const files = await readdir(skillsPath)
    return files.filter((f) => f.endsWith(".md"))
  } catch {
    return []
  }
}
