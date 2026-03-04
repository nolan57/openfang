import * as fs from "fs"
import * as path from "path"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-deployer" })

export type DeploymentType = "code_change" | "skill_install" | "config_update"
export type DeploymentStatus = "pending" | "executing" | "completed" | "failed" | "rolled_back"

export interface DeploymentTask {
  id: string
  type: DeploymentType
  status: DeploymentStatus
  title: string
  description: string
  changes: {
    files: string[]
    diff_summary: string
  }
  commands: string[]
  rollback_commands: string[]
  created_at: number
  updated_at: number
  executed_at?: number
  completed_at?: number
  error?: string
}

export interface DeploymentResult {
  success: boolean
  task_id: string
  output?: string
  error?: string
}

export class Deployer {
  private tasksDir: string

  constructor(tasksDir = "docs/learning/tasks") {
    this.tasksDir = tasksDir
    this.ensureDir()
  }

  private ensureDir() {
    if (!fs.existsSync(this.tasksDir)) {
      fs.mkdirSync(this.tasksDir, { recursive: true })
    }
  }

  async createTask(data: {
    type: DeploymentType
    title: string
    description: string
    changes: { files: string[]; diff_summary: string }
    commands: string[]
    rollback_commands: string[]
  }): Promise<string> {
    const id = crypto.randomUUID().slice(0, 8)
    const task: DeploymentTask = {
      id,
      type: data.type,
      status: "pending",
      title: data.title,
      description: data.description,
      changes: data.changes,
      commands: data.commands,
      rollback_commands: data.rollback_commands,
      created_at: Date.now(),
      updated_at: Date.now(),
    }

    const filepath = this.getTaskPath(id)
    fs.writeFileSync(filepath, JSON.stringify(task, null, 2))

    log.info("deployment_task_created", { id, type: data.type, title: data.title })

    return id
  }

  async getTask(id: string): Promise<DeploymentTask | null> {
    const filepath = this.getTaskPath(id)
    if (!fs.existsSync(filepath)) {
      return null
    }
    return JSON.parse(fs.readFileSync(filepath, "utf-8"))
  }

  async updateTaskStatus(id: string, status: DeploymentStatus, error?: string): Promise<void> {
    const task = await this.getTask(id)
    if (!task) {
      log.error("task_not_found", { id })
      return
    }

    task.status = status
    task.updated_at = Date.now()

    if (status === "executing") {
      task.executed_at = Date.now()
    }
    if (status === "completed" || status === "failed" || status === "rolled_back") {
      task.completed_at = Date.now()
    }
    if (error) {
      task.error = error
    }

    const filepath = this.getTaskPath(id)
    fs.writeFileSync(filepath, JSON.stringify(task, null, 2))

    log.info("task_status_updated", { id, status })
  }

  async getPendingTasks(): Promise<DeploymentTask[]> {
    if (!fs.existsSync(this.tasksDir)) {
      return []
    }

    const files = fs.readdirSync(this.tasksDir).filter((f) => f.endsWith(".json"))

    const tasks: DeploymentTask[] = []
    for (const file of files) {
      const content = fs.readFileSync(path.join(this.tasksDir, file), "utf-8")
      const task: DeploymentTask = JSON.parse(content)
      if (task.status === "pending") {
        tasks.push(task)
      }
    }

    return tasks.sort((a, b) => a.created_at - b.created_at)
  }

  async getLatestTask(): Promise<DeploymentTask | null> {
    if (!fs.existsSync(this.tasksDir)) {
      return null
    }

    const files = fs.readdirSync(this.tasksDir).filter((f) => f.endsWith(".json"))
    if (files.length === 0) {
      return null
    }

    const latestFile = files.sort().reverse()[0]
    const content = fs.readFileSync(path.join(this.tasksDir, latestFile), "utf-8")
    return JSON.parse(content)
  }

  private getTaskPath(id: string): string {
    return path.join(this.tasksDir, `${id}.json`)
  }

  async createCodeChangeTask(params: {
    files: string[]
    diff_summary: string
    build_command: string
    restart_command: string
  }): Promise<string> {
    return this.createTask({
      type: "code_change",
      title: "Self-evolution: Code change",
      description: `Applying changes to ${params.files.length} files`,
      changes: {
        files: params.files,
        diff_summary: params.diff_summary,
      },
      commands: [
        "git add -A",
        `git commit -m "feat: self-evolution - ${params.diff_summary}"`,
        params.build_command,
        params.restart_command,
      ],
      rollback_commands: ["git reset --hard HEAD~1", params.restart_command],
    })
  }

  async createConfigUpdateTask(params: {
    config_name: string
    description: string
    commands: string[]
    rollback_commands: string[]
  }): Promise<string> {
    return this.createTask({
      type: "config_update",
      title: `Config update: ${params.config_name}`,
      description: params.description,
      changes: {
        files: ["opencode.json"],
        diff_summary: params.description,
      },
      commands: params.commands,
      rollback_commands: params.rollback_commands,
    })
  }
}
