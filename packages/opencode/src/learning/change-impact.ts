import { KnowledgeGraph, type KnowledgeNode, type RelationType } from "./knowledge-graph"
import { Log } from "../util/log"
import * as fs from "fs"
import * as path from "path"

const log = Log.create({ service: "change-impact" })

export interface ImpactRecord {
  file: string
  changed_at: number
  changed_by: string
  changes_summary: string
  affected_nodes: string[]
  marked_outdated: boolean
}

export class ChangeImpactTracker {
  private graph: KnowledgeGraph

  constructor() {
    this.graph = new KnowledgeGraph()
  }

  async trackChange(params: { file: string; changed_by: string; changes_summary: string }): Promise<ImpactRecord> {
    const fileNode = await this.findOrCreateFileNode(params.file)

    const relatedNodes = await this.findAffectedNodes(params.file)

    for (const node of relatedNodes) {
      await this.graph.addEdge({
        source_id: fileNode.id,
        target_id: node.id,
        relation: "may_affect" as RelationType,
        weight: this.calculateImpactWeight(node.type),
      })
    }

    const existingNode = await this.graph.getNode(fileNode.id)
    await this.graph.updateNode(fileNode.id, {
      metadata: {
        ...existingNode?.metadata,
        last_changed: Date.now(),
        changed_by: params.changed_by,
        changes_summary: params.changes_summary,
      },
    })

    const record: ImpactRecord = {
      file: params.file,
      changed_at: Date.now(),
      changed_by: params.changed_by,
      changes_summary: params.changes_summary,
      affected_nodes: relatedNodes.map((n) => n.title),
      marked_outdated: relatedNodes.length > 0,
    }

    log.info("change_tracked", {
      file: params.file,
      affected_count: relatedNodes.length,
    })

    return record
  }

  private async findOrCreateFileNode(filePath: string): Promise<KnowledgeNode> {
    const existing = await this.graph.searchByContent(filePath, 1)
    const fileNode = existing.find((n) => n.entity_id === filePath && n.type === "file")

    if (fileNode) return fileNode

    const id = await this.graph.addNode({
      type: "file",
      entity_type: "source_code",
      entity_id: filePath,
      title: path.basename(filePath),
      content: this.extractFileContext(filePath),
    })

    return (await this.graph.getNode(id))!
  }

  private async findAffectedNodes(filePath: string): Promise<KnowledgeNode[]> {
    const affected: KnowledgeNode[] = []

    const baseName = path.basename(filePath, path.extname(filePath))
    const dirName = path.dirname(filePath)

    const memories = await this.graph.findNodesByType("memory")
    for (const memory of memories) {
      if (memory.content?.includes(baseName) || memory.content?.includes(filePath)) {
        affected.push(memory)
      }
    }

    const constraints = await this.graph.findNodesByType("constraint")
    for (const constraint of constraints) {
      if (constraint.content?.includes(baseName)) {
        affected.push(constraint)
      }
    }

    const agentsFiles = await this.findAGENTSFiles(dirName)
    for (const agentsFile of agentsFiles) {
      const content = fs.readFileSync(agentsFile, "utf-8")
      if (content.includes(baseName) || content.includes(filePath)) {
        const existing = await this.graph.searchByContent(agentsFile, 1)
        const agentsNode = existing.find((n) => n.entity_id === agentsFile)
        if (agentsNode) affected.push(agentsNode)
      }
    }

    return affected
  }

  private async findAGENTSFiles(dir: string): Promise<string[]> {
    const agentsFiles: string[] = []
    let current = dir

    while (current !== path.dirname(current)) {
      const agentsPath = path.join(current, "AGENTS.md")
      if (fs.existsSync(agentsPath)) {
        agentsFiles.push(agentsPath)
      }
      current = path.dirname(current)
    }

    return agentsFiles
  }

  private extractFileContext(filePath: string): string {
    try {
      if (!fs.existsSync(filePath)) return ""

      const content = fs.readFileSync(filePath, "utf-8")
      const lines = content.split("\n").slice(0, 50).join("\n")

      return lines
    } catch {
      return ""
    }
  }

  private calculateImpactWeight(nodeType: string): number {
    switch (nodeType) {
      case "memory":
        return 3
      case "constraint":
        return 5
      case "agenda":
        return 4
      default:
        return 1
    }
  }

  async markOutdated(nodes: KnowledgeNode[]): Promise<void> {
    for (const node of nodes) {
      await this.graph.updateNode(node.id, {
        metadata: {
          ...node.metadata,
          outdated: true,
          outdated_since: Date.now(),
        },
      })
    }

    log.info("nodes_marked_outdated", { count: nodes.length })
  }

  async getImpactHistory(filePath: string, limit = 10): Promise<ImpactRecord[]> {
    const memories = await this.graph.findNodesByType("memory")
    const relevant = memories
      .filter((m) => m.metadata?.last_changed)
      .sort((a, b) => (b.metadata?.last_changed as number) - (a.metadata?.last_changed as number))
      .slice(0, limit)

    return relevant.map((m) => ({
      file: filePath,
      changed_at: m.metadata?.last_changed as number,
      changed_by: m.metadata?.changed_by as string,
      changes_summary: m.metadata?.changes_summary as string,
      affected_nodes: [],
      marked_outdated: m.metadata?.outdated as boolean,
    }))
  }
}
