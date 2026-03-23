# Learning → Evolution Feedback Loop

## Overview

The Learning → Evolution Feedback Loop enables the learning system to **analyze, propose, and apply modifications** to evolution artifacts (prompts, skills, memories). This creates a closed feedback loop where learning insights can directly improve the evolution system.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Learning → Evolution Feedback Loop                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐    │
│  │ EvolutionAnalyzer │ ──→ │ Modifier         │ ──→ │ Safety/Review    │    │
│  │                  │     │                  │     │                  │    │
│  │ • Analyze prompts│     │ • Create proposal│     │ • Human review   │    │
│  │ • Analyze skills │     │ • Submit review  │     │ • Approval flow  │    │
│  │ • Analyze memories│    │ • Apply changes  │     │ • Rejection      │    │
│  └──────────────────┘     └──────────────────┘     └──────────────────┘    │
│           ↓                       ↓                        ↓                │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    Knowledge Graph / Vector Store                     │   │
│  │                    (Persistent Learning Storage)                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. EvolutionAnalyzer (`src/learning/evolution-analyzer.ts`)

Analyzes evolution artifacts to identify improvement opportunities.

**Issue Types Detected:**

| Type | Severity | Description |
|------|----------|-------------|
| `prompt_redundant` | low | Similar prompts that could be merged |
| `prompt_outdated` | low | Zero usage after 7+ days |
| `prompt_ineffective` | high | Prompts with poor success rates |
| `skill_unused` | medium | Draft skills pending 14+ days |
| `skill_ineffective` | low | Rejected skills worth revisiting |
| `skill_code_quality` | medium | Code quality issues (console.log, :any, TODOs) |
| `memory_duplicate` | low | Multiple memories with same key |
| `memory_contradiction` | high | Conflicting memory values |
| `memory_stale` | low | Unused for 90+ days |

**Usage:**

```typescript
import { EvolutionAnalyzer } from "@opencode-ai/learning"

const analyzer = new EvolutionAnalyzer(projectDir)

// Analyze all artifacts
const analysis = await analyzer.analyzeAll()
console.log(`Found ${analysis.total_issues} issues`)

// Analyze specific artifact types
const promptAnalysis = await analyzer.analyzePrompts()
const skillAnalysis = await analyzer.analyzeSkills()
const memoryAnalysis = await analyzer.analyzeMemories()

// Prioritize issues by severity
const prioritized = EvolutionAnalyzer.prioritizeIssues(allIssues)
```

### 2. LearningToEvolutionModifier (`src/learning/evolution-modifier.ts`)

Creates and applies modification proposals to evolution artifacts.

**Modification Types:**

| Type | Target | Description |
|------|--------|-------------|
| `prompt_optimization` | prompt | Update prompt with optimized version |
| `prompt_merge` | prompt | Merge multiple similar prompts |
| `prompt_deletion` | prompt | Remove outdated prompt |
| `skill_code_fix` | skill | Fix code quality issues |
| `skill_merge` | skill | Merge similar skills |
| `skill_deletion` | skill | Remove unused skill |
| `memory_compress` | memory | Compress duplicate memories |
| `memory_archive` | memory | Archive stale memory |
| `memory_deletion` | memory | Delete obsolete memory |
| `memory_merge` | memory | Merge related memories |

**Usage:**

```typescript
import { LearningToEvolutionModifier } from "@opencode-ai/learning"
import { Safety } from "@opencode-ai/learning"

const modifier = new LearningToEvolutionModifier(projectDir)
await modifier.init()

// Optional: Set up safety for human review
const safety = new Safety()
modifier.setSafety(safety)

// Create a proposal
const proposal = await modifier.createProposal({
  type: "prompt_optimization",
  target_id: "prompt-123",
  target_name: "Code Helper Prompt",
  changes: {
    optimizedPrompt: "You are an expert software engineer...",
    originalPrompt: "You are a helpful assistant...",
  },
  reason: "Learning identified better phrasing from successful sessions",
  evidence: "Analysis of 50 sessions with 90% success rate",
})

// Submit for human review
await modifier.submitForReview(proposal)

// Or apply directly (if no review required)
const result = await modifier.applyModification(proposal)
```

### 3. LearningFeedbackLoop (`src/learning/feedback-loop.ts`)

Orchestrates the complete feedback cycle from analysis to application.

**Configuration:**

```typescript
interface FeedbackLoopConfig {
  autoGenerateProposals: boolean    // Auto-create proposals from insights
  minSeverity: "low" | "medium" | "high"  // Minimum severity for auto-proposals
  maxProposalsPerCycle: number      // Limit proposals per cycle
  requireHumanReview: boolean       // Require human approval
  safety?: Partial<SafetyConfig>    // Safety system config
}
```

**Usage:**

```typescript
import { LearningFeedbackLoop } from "@opencode-ai/learning"

const feedbackLoop = new LearningFeedbackLoop(projectDir, {
  autoGenerateProposals: true,
  minSeverity: "medium",
  maxProposalsPerCycle: 10,
  requireHumanReview: true,
})

await feedbackLoop.initialize()

// Run a complete feedback cycle
const result = await feedbackLoop.runCycle()
console.log(`Analyzed ${result.issues_analyzed} issues`)
console.log(`Created ${result.proposals_created} proposals`)
console.log(`Applied ${result.proposals_applied} modifications`)

// Process individual learning insights
const insight = {
  type: "improvement",
  category: "prompt",
  description: "Better prompt phrasing identified",
  evidence: "Analysis of 100 sessions",
  severity: "medium",
  suggested_action: "Use more specific instructions",
  metadata: { prompt_id: "prompt-123" },
}

const proposal = await feedbackLoop.processLearningInsight(insight)
```

## Workflow

### 1. Analysis Phase

```
Session Complete → EvolutionAnalyzer → Issues Identified
                                              ↓
                                    Prioritized by Severity
```

### 2. Proposal Phase

```
Issues → CreateProposal → Save to .opencode/evolution/proposals/
                              ↓
                    Status: "draft" → "pending_review"
```

### 3. Review Phase (User Action Required)

```
User checks pending reviews → Reviews details → Approves or Rejects
```

**User API for handling reviews:**

```typescript
import { LearningFeedbackLoop } from "@opencode-ai/learning"

const feedbackLoop = new LearningFeedbackLoop(projectDir)
await feedbackLoop.initialize()

// 1. Get all pending reviews
const pending = await feedbackLoop.getPendingReviews()
console.log(`Pending reviews: ${pending.length}`)

for (const review of pending) {
  console.log(`- ${review.title}`)
  console.log(`  Description: ${review.description}`)
  console.log(`  Type: ${review.proposal_type}`)
  console.log(`  Created: ${new Date(review.created_at).toISOString()}`)
}

// 2. Approve a review (by proposal_id or review_id)
const approveResult = await feedbackLoop.approveProposal("proposal-123")
if (approveResult.success) {
  console.log("Modification applied successfully")
} else {
  console.error("Approval failed:", approveResult.error)
}

// 3. Reject a review with reason
const rejectResult = await feedbackLoop.rejectProposal(
  "proposal-456",
  "Not needed at this time, will revisit later"
)

// 4. Get review statistics
const stats = await feedbackLoop.getReviewStats()
console.log(`Pending: ${stats.pending_count}`)
console.log(`Approved: ${stats.approved_count}`)
console.log(`Rejected: ${stats.rejected_count}`)
console.log(`Applied: ${stats.total_applied}`)
```

### 4. Application Phase

```
Approved → Apply Modification → Update Evolution Artifact
                                      ↓
                                Status: "applied"
                                      ↓
                                Link in Knowledge Graph
```

## Integration with Existing Systems

### Safety System

All modifications can require human review via the Safety system:

```typescript
import { Safety, LearningFeedbackLoop } from "@opencode-ai/learning"

const safety = new Safety({
  requireHumanReviewFor: ["evolution_modification"],
  reviewTimeout: 7 * 24 * 60 * 60 * 1000, // 7 days
})

const feedbackLoop = new LearningFeedbackLoop(projectDir, {
  requireHumanReview: true,
  safety: { /* config */ },
})

feedbackLoop.setSafety(safety)
```

### Knowledge Graph

Modifications are linked to artifacts in the knowledge graph:

```typescript
await feedbackLoop.linkInsightToArtifact(
  "insight-123",
  "prompt-456",
  "suggests_improvement",
)
```

### Vector Store

Proposals and modifications are indexed for semantic search:

```typescript
const vectorStore = await getSharedVectorStore()
await vectorStore.store({
  node_type: "evolution_proposal",
  node_id: proposal.id,
  entity_title: proposal.type,
  vector_type: "content",
  metadata: proposal,
})
```

## File Structure

```
.opencode/
├── evolution/
│   ├── prompts.json           # Prompt evolutions
│   ├── skills.json            # Skill evolutions
│   ├── memories-YYYY-MM.json  # Monthly memory files
│   └── proposals/             # Modification proposals
│       ├── <proposal-id>.json
│       └── <proposal-id>.json
└── skills/                    # Approved skill deployments
    ├── <skill-name>/
    │   ├── SKILL.md
    │   └── test-results.json
```

## Proposal File Format

```json
{
  "id": "proposal-uuid",
  "type": "prompt_optimization",
  "status": "pending_review",
  "target_type": "prompt",
  "target_id": "prompt-123",
  "target_name": "Code Helper",
  "changes": {
    "optimizedPrompt": "New prompt...",
    "originalPrompt": "Old prompt..."
  },
  "reason": "Learning identified improvement",
  "evidence": "Analysis details...",
  "created_at": 1234567890,
  "updated_at": 1234567890,
  "review_request_id": "review-uuid",
  "related_issues": [...]
}
```

## Best Practices

### 1. Configure Appropriate Severity Thresholds

```typescript
// Production: Require review for all changes
const feedbackLoop = new LearningFeedbackLoop(projectDir, {
  minSeverity: "low",
  requireHumanReview: true,
})

// Development: Auto-apply low-severity changes
const feedbackLoop = new LearningFeedbackLoop(projectDir, {
  minSeverity: "medium",
  requireHumanReview: false,
})
```

### 2. Monitor Proposal Statistics

```typescript
const stats = await feedbackLoop.getStats()
console.log(`Pending reviews: ${stats.pending_reviews}`)
console.log(`Applied: ${stats.applied_count}`)
```

### 3. Batch Process Proposals

```typescript
// Process all approved proposals
const approved = await feedbackLoop.getProposals("approved")
for (const proposal of approved) {
  await feedbackLoop.approveProposal(proposal.id)
}
```

### 4. Link Related Insights

```typescript
// Create knowledge graph links between related modifications
await feedbackLoop.linkInsightToArtifact(
  insightId,
  artifactId,
  "identifies_issue",
)
```

## Error Handling

```typescript
try {
  const result = await feedbackLoop.runCycle()
  if (result.errors.length > 0) {
    console.error("Cycle errors:", result.errors)
  }
} catch (error) {
  console.error("Feedback loop failed:", error)
}
```

## Testing

```typescript
import { describe, it, expect } from "bun:test"
import { EvolutionAnalyzer, LearningFeedbackLoop } from "@opencode-ai/learning"

describe("Learning → Evolution", () => {
  it("should detect and propose fixes", async () => {
    const analyzer = new EvolutionAnalyzer(testDir)
    const analysis = await analyzer.analyzeAll()

    expect(analysis.total_issues).toBeGreaterThan(0)
  })

  it("should complete feedback cycle", async () => {
    const loop = new LearningFeedbackLoop(testDir)
    await loop.initialize()

    const result = await loop.runCycle()
    expect(result).toBeDefined()
  })
})
```

## API Reference

### EvolutionAnalyzer

| Method | Returns | Description |
|--------|---------|-------------|
| `analyzeAll()` | `{ prompts, skills, memories, total_issues }` | Analyze all artifacts |
| `analyzePrompts()` | `PromptAnalysis` | Analyze prompt evolutions |
| `analyzeSkills()` | `SkillAnalysis` | Analyze skill evolutions |
| `analyzeMemories()` | `MemoryAnalysis` | Analyze memory entries |
| `static prioritizeIssues(issues)` | `EvolutionIssue[]` | Sort by severity |

### LearningToEvolutionModifier

| Method | Returns | Description |
|--------|---------|-------------|
| `init()` | `void` | Initialize modifier |
| `createProposal(input)` | `ModificationProposal` | Create new proposal |
| `submitForReview(proposal)` | `ModificationProposal` | Submit for review |
| `applyModification(proposal)` | `ApplyModificationResult` | Apply modification |
| `getProposals(status?)` | `ModificationProposal[]` | Get proposals |
| `getProposal(id)` | `ModificationProposal \| null` | Get specific proposal |
| `deleteProposal(id)` | `boolean` | Delete proposal |
| `autoGenerateProposals(options)` | `ModificationProposal[]` | Auto-generate from analysis |

### LearningFeedbackLoop

| Method | Returns | Description |
|--------|---------|-------------|
| `initialize()` | `void` | Initialize feedback loop |
| `runCycle()` | `FeedbackCycleResult` | Run complete cycle |
| `processLearningInsight(insight)` | `ModificationProposal \| null` | Process insight |
| `getPendingReviews()` | `ReviewInfo[]` | Get pending reviews with details |
| `approveProposal(id)` | `{ success, error? }` | Approve and apply a proposal |
| `rejectProposal(id, reason)` | `{ success, error? }` | Reject a proposal |
| `getReviewStats()` | `ReviewStats` | Get review statistics |
| `getProposal(id)` | `ModificationProposal \| null` | Get specific proposal |
| `getStats()` | `FeedbackStats` | Get feedback loop statistics |
| `linkInsightToArtifact(insightId, artifactId, relation)` | `string \| null` | Link in KG |

### ReviewInfo Type

```typescript
interface ReviewInfo {
  review_id: string
  proposal_id: string
  title: string
  description: string
  created_at: number
  proposal_type: ModificationType
  target_name?: string
}
```

### ReviewStats Type

```typescript
interface ReviewStats {
  pending_count: number
  approved_count: number
  rejected_count: number
  total_applied: number
}
```

## See Also

- [Safety System](./safety.md) - Human review workflow
- [Knowledge Graph](./knowledge-graph.md) - Persistent knowledge storage
- [Vector Store](./vector-store.md) - Semantic search and retrieval
- [Evolution System](../evolution/README.md) - Self-evolution architecture
