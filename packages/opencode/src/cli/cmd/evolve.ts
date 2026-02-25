import type { CommandModule } from "yargs"
import { cmd } from "./cmd"
import { getSkillEvolutions, getPromptEvolutions, getMemories } from "../../evolution/store"
import { approveSkill, rejectSkill, getPendingSkills } from "../../evolution/skill"

export const EvolveCommand: CommandModule = {
  command: "evolve",
  describe: "Manage self-evolving agent system",
  builder: (yargs) =>
    yargs
      .command("list", "List evolution artifacts", {}, listArtifacts)
      .command(
        "approve <skillID>",
        "Approve and create a skill",
        (yargs) => yargs.positional("skillID", { type: "string", demandOption: true }),
        (args) => approveSkillCmd(args.skillID as string),
      )
      .command(
        "reject <skillID>",
        "Reject a skill proposal",
        (yargs) => yargs.positional("skillID", { type: "string", demandOption: true }),
        (args) => rejectSkillCmd(args.skillID as string),
      )
      .command("memories", "List learned memories", {}, listMemories)
      .command("pending", "List pending skill approvals", {}, listPending)
      .demandCommand(),
  handler: () => {},
}

async function listArtifacts() {
  const dir = process.cwd()
  const [prompts, skills, memories] = await Promise.all([
    getPromptEvolutions(dir),
    getSkillEvolutions(dir),
    getMemories(dir),
  ])

  console.log("\n=== Prompt Optimizations ===")
  console.log(prompts.length, "optimizations")
  for (const p of prompts) {
    console.log(`  - ${p.originalPrompt.slice(0, 40)}... -> ${p.optimizedPrompt.slice(0, 40)}...`)
  }

  console.log("\n=== Generated Skills ===")
  for (const s of skills) {
    console.log(`[${s.status}] ${s.name}: ${s.description}`)
  }

  console.log("\n=== Memories ===")
  console.log(memories.length, "memories")
}

async function approveSkillCmd(skillID: string) {
  const dir = process.cwd()
  const skillDir = await approveSkill(dir, skillID)
  if (skillDir) {
    console.log(`Skill created at: ${skillDir}`)
  } else {
    console.log("Skill not found")
  }
}

async function rejectSkillCmd(skillID: string) {
  const dir = process.cwd()
  await rejectSkill(dir, skillID)
  console.log("Skill rejected")
}

async function listMemories() {
  const dir = process.cwd()
  const memories = await getMemories(dir)
  for (const m of memories) {
    console.log(`\n[${m.key}]`)
    console.log(`  ${m.value}`)
    console.log(`  Used ${m.usageCount} times`)
  }
}

async function listPending() {
  const dir = process.cwd()
  const skills = await getPendingSkills(dir)
  console.log("\n=== Pending Skills ===")
  for (const s of skills) {
    console.log(`${s.id}: ${s.name} - ${s.description}`)
  }
}

export default EvolveCommand
