import { Provider } from "../provider/provider"
import { generateText } from "ai"
import { KnowledgeGraph } from "./knowledge-graph"
import { getSharedVectorStore, type IVectorStore } from "./vector-store"
import { Log } from "../util/log"
import { saveMemory } from "../evolution/store"
import { Instance } from "../project/instance"

const log = Log.create({ service: "dynamic-query-generator" })

export interface QueryGenerationResult {
  queries: string[]
  rationale: string
  confidence: number
}

const QUERY_GENERATION_PROMPT = `You are an AI coding assistant that helps identify knowledge gaps in a project.
Based on the project overview and recent changes, generate 3-5 search queries to find relevant information
that would help improve the project.

Respond ONLY with valid JSON array of strings, no other text.

Project Overview:
{projectOverview}

Recent Gaps Identified:
{gaps}

Current Module Summaries (for context):
{moduleSummaries}

Output format: ["query1", "query2", "query3"]`

/**
 * Dynamic Query Generator
 * Generates search queries based on project gaps and context
 */
export class DynamicQueryGenerator {
  private knowledgeGraph: KnowledgeGraph
  private vectorStore: IVectorStore | null = null

  constructor() {
    this.knowledgeGraph = new KnowledgeGraph()
  }

  private async getVectorStore(): Promise<IVectorStore> {
    if (!this.vectorStore) {
      this.vectorStore = await getSharedVectorStore()
    }
    return this.vectorStore
  }

  /**
   * Generate search queries based on project gaps
   */
  async generateQueries(projectOverview: string, maxQueries: number = 5): Promise<QueryGenerationResult> {
    try {
      // Get gaps from knowledge graph
      const gaps = await this.getProjectGaps()

      // Get relevant module summaries
      const moduleSummaries = await this.getRelevantModuleSummaries(gaps)

      // Use LLM to generate queries
      const queries = await this.generateQueriesWithLLM(
        projectOverview,
        gaps,
        moduleSummaries,
        maxQueries,
      )

      return {
        queries,
        rationale: `Generated ${queries.length} queries based on ${gaps.length} identified gaps`,
        confidence: 0.8,
      }
    } catch (error) {
      log.error("query_generation_failed", { error: String(error) })
      return {
        queries: this.getFallbackQueries(),
        rationale: "Using fallback queries due to generation failure",
        confidence: 0.3,
      }
    }
  }

  /**
   * Generate queries based on recent code changes
   */
  async generateQueriesForChanges(
    projectOverview: string,
    recentChanges: string[],
  ): Promise<QueryGenerationResult> {
    try {
      const gaps = recentChanges.map((change) => `Recent change: ${change}`)

      const queries = await this.generateQueriesWithLLM(
        projectOverview,
        gaps,
        "No module summaries available",
        5,
      )

      return {
        queries,
        rationale: `Generated queries based on ${recentChanges.length} recent changes`,
        confidence: 0.75,
      }
    } catch (error) {
      log.error("query_generation_for_changes_failed", { error: String(error) })
      return {
        queries: this.getFallbackQueries(),
        rationale: "Using fallback queries",
        confidence: 0.3,
      }
    }
  }

  /**
   * Generate queries based on missing capabilities
   */
  async generateQueriesForMissingCapabilities(
    projectOverview: string,
    missingCapabilities: string[],
  ): Promise<QueryGenerationResult> {
    const gaps = missingCapabilities.map((cap) => `Missing capability: ${cap}`)

    const queries = await this.generateQueriesWithLLM(
      projectOverview,
      gaps,
      "No module summaries available",
      5,
    )

    return {
      queries,
      rationale: `Generated queries to address ${missingCapabilities.length} missing capabilities`,
      confidence: 0.85,
    }
  }

  private async getProjectGaps(): Promise<string[]> {
    try {
      // Find nodes marked as gaps or issues
      const gapNodes = await this.knowledgeGraph.findNodesByType("agenda")
      const issueNodes = await this.knowledgeGraph.findNodesByType("constraint")

      const gaps: string[] = []

      for (const node of [...gapNodes, ...issueNodes]) {
        if (node.title) gaps.push(node.title)
        if (node.content) gaps.push(node.content)
      }

      return gaps.slice(0, 10)
    } catch (error) {
      log.warn("failed_to_get_gaps", { error: String(error) })
      return []
    }
  }

  private async getRelevantModuleSummaries(gaps: string[]): Promise<string> {
    if (gaps.length === 0) return "No gaps identified"

    try {
      const vs = await this.getVectorStore()
      const searchResults = await vs.search(gaps.join(" "), {
        limit: 5,
        node_type: "module_summary",
      })

      return searchResults
        .map((r) => `${r.entity_title}: ${r.metadata?.purpose || ""}`)
        .join("\n")
    } catch (error) {
      log.warn("failed_to_get_summaries", { error: String(error) })
      return "Unable to retrieve module summaries"
    }
  }

  private async generateQueriesWithLLM(
    projectOverview: string,
    gaps: string[],
    moduleSummaries: string,
    maxQueries: number,
  ): Promise<string[]> {
    const modelInfo = await Provider.defaultModel()
    const model = await Provider.getModel(modelInfo.providerID, modelInfo.modelID)
    const languageModel = await Provider.getLanguage(model)

    const prompt = QUERY_GENERATION_PROMPT
      .replace("{projectOverview}", projectOverview.slice(0, 500))
      .replace("{gaps}", gaps.slice(0, 5).join("\n") || "No specific gaps identified")
      .replace("{moduleSummaries}", moduleSummaries.slice(0, 500))

    const result = await generateText({
      model: languageModel,
      system: "You are a helpful assistant that generates search queries for finding relevant information.",
      prompt,
    })

    const text = result.text.trim()
    const jsonMatch = text.match(/\[[\s\S]*\]/)

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) {
          return parsed.slice(0, maxQueries).map(String)
        }
      } catch {
        // Fall through to fallback
      }
    }

    return this.getFallbackQueries()
  }

  private getFallbackQueries(): string[] {
    return [
      "AI code generation best practices 2025",
      "autonomous agent architecture patterns",
      "LLM agent self-improvement techniques",
    ]
  }

  // [ENH] Target 3: Execute queries and create feedback loop
  /**
   * Result of a single query execution
   */
  async executeQuery(query: string): Promise<QueryExecutionResult> {
    const vs = await this.getVectorStore()
    const startTime = Date.now()

    try {
      // Search internal knowledge base
      const searchResults = await vs.search(query, {
        limit: 5,
        min_similarity: 0.2,
      })

      const duration = Date.now() - startTime
      const isEmpty = searchResults.length === 0

      log.info("query_executed", {
        query,
        resultCount: searchResults.length,
        duration,
        isEmpty,
      })

      return {
        query,
        results: searchResults.map((r) => ({
          id: r.id,
          title: r.entity_title,
          similarity: r.similarity,
          preview: r.metadata?.contentPreview as string | undefined,
        })),
        isEmpty,
        duration,
      }
    } catch (error) {
      log.error("query_execution_failed", { query, error: String(error) })
      return {
        query,
        results: [],
        isEmpty: true,
        duration: Date.now() - startTime,
        error: String(error),
      }
    }
  }

  /**
   * Execute all generated queries and create feedback loop
   * This implements the closed-loop learning cycle:
   * 1. Generate queries based on project gaps
   * 2. Execute searches against internal knowledge
   * 3. Store results as evolution memories
   * 4. Record knowledge gaps for future exploration
   */
  async executeGeneratedQueries(
    projectOverview: string,
    options?: {
      maxQueries?: number
      storeResults?: boolean
      onProgress?: (result: QueryExecutionResult) => void
    },
  ): Promise<QueryLoopResult> {
    const maxQueries = options?.maxQueries ?? 5
    const storeResults = options?.storeResults ?? true
    const projectDir = Instance.directory

    const loopStartTime = Date.now()

    log.info("query_loop_started", { maxQueries, storeResults })

    // Step 1: Generate queries
    const generationResult = await this.generateQueries(projectOverview, maxQueries)

    // Step 2: Execute each query
    const executionResults: QueryExecutionResult[] = []
    const knowledgeGaps: string[] = []

    for (const query of generationResult.queries) {
      const result = await this.executeQuery(query)
      executionResults.push(result)

      // Report progress
      options?.onProgress?.(result)

      // Track knowledge gaps
      if (result.isEmpty) {
        knowledgeGaps.push(query)
      }
    }

    // Step 3: Store results as evolution memories
    if (storeResults) {
      for (const result of executionResults) {
        if (!result.isEmpty) {
          try {
            await saveMemory(projectDir, {
              key: `query_feedback:${result.query.slice(0, 50)}`,
              value: JSON.stringify({
                query: result.query,
                resultCount: result.results.length,
                topResults: result.results.slice(0, 3),
                timestamp: Date.now(),
              }),
              context: "dynamic_query_feedback",
              sessionIDs: [],
            })
          } catch (error) {
            log.warn("failed_to_store_query_result", {
              query: result.query,
              error: String(error),
            })
          }
        }
      }

      // Step 4: Record unresolved knowledge gaps
      if (knowledgeGaps.length > 0) {
        try {
          await saveMemory(projectDir, {
            key: "knowledge_gaps:unresolved",
            value: JSON.stringify({
              gaps: knowledgeGaps,
              generatedAt: Date.now(),
              priority: "high",
            }),
            context: "knowledge_gap_tracking",
            sessionIDs: [],
          })

          log.info("knowledge_gaps_recorded", { count: knowledgeGaps.length })
        } catch (error) {
          log.warn("failed_to_record_gaps", { error: String(error) })
        }
      }
    }

    const totalDuration = Date.now() - loopStartTime

    log.info("query_loop_completed", {
      queriesExecuted: executionResults.length,
      knowledgeGapsFound: knowledgeGaps.length,
      totalDuration,
    })

    return {
      generationResult,
      executionResults,
      knowledgeGaps,
      totalDuration,
      summary: {
        totalQueries: executionResults.length,
        successfulQueries: executionResults.filter((r) => !r.isEmpty).length,
        gapsIdentified: knowledgeGaps.length,
      },
    }
  }

  /**
   * Get statistics about recent query executions
   */
  async getExecutionStats(): Promise<{
    totalQueries: number
    avgResultsPerQuery: number
    gapRate: number
  }> {
    // This would normally query stored results
    // For now, return placeholder stats
    return {
      totalQueries: 0,
      avgResultsPerQuery: 0,
      gapRate: 0,
    }
  }
}

// [ENH] Target 3: Types for query execution
export interface QueryExecutionResult {
  query: string
  results: Array<{
    id: string
    title: string
    similarity: number
    preview?: string
  }>
  isEmpty: boolean
  duration: number
  error?: string
}

export interface QueryLoopResult {
  generationResult: QueryGenerationResult
  executionResults: QueryExecutionResult[]
  knowledgeGaps: string[]
  totalDuration: number
  summary: {
    totalQueries: number
    successfulQueries: number
    gapsIdentified: number
  }
}

/**
 * Create dynamic query generator instance
 */
export function createDynamicQueryGenerator(): DynamicQueryGenerator {
  return new DynamicQueryGenerator()
}