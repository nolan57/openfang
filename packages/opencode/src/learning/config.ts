import { z } from "zod"

export const LearningSource = z.enum(["search", "arxiv", "github", "blogs", "pypi"])
export type LearningSource = z.infer<typeof LearningSource>

export const LearningSchedule = z.object({
  cron: z.string().optional(),
  idle_check: z.boolean(),
  idle_threshold_minutes: z.number(),
})
export type LearningSchedule = z.infer<typeof LearningSchedule>

export const LearningConfig = z.object({
  enabled: z.boolean(),
  schedule: LearningSchedule,
  sources: z.array(LearningSource),
  topics: z.array(z.string()),
  max_items_per_run: z.number(),
  note_output_dir: z.string(),
  spec_file: z.string().optional(),
})
export type LearningConfig = z.infer<typeof LearningConfig>

export const defaultLearningConfig: LearningConfig = {
  enabled: true,
  schedule: {
    cron: undefined,
    idle_check: true,
    idle_threshold_minutes: 30,
  },
  sources: ["search", "arxiv", "github"],
  topics: ["AI", "code generation", "agent systems"],
  max_items_per_run: 10,
  note_output_dir: "docs/learning/notes",
}
