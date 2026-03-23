# In-Session Review

## Overview

In-Session Review allows users to directly review and approve Evolution modification proposals within the chat session, without using external APIs or CLI commands.

## Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        In-Session Review Flow                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Session Start                                                           │
│     └─→ Check pending review requests                                        │
│         └─→ Has pending → Display review notification                        │
│                                                                             │
│  2. User Input                                                              │
│     └─→ Check if review command                                             │
│         ├─→ approve <id> → Approve and apply                                │
│         ├─→ reject <id> <reason> → Reject                                   │
│         └─→ list reviews → Show all pending                                 │
│                                                                             │
│  3. Auto-Present (Optional)                                                 │
│     └─→ First pending request auto-displayed                                │
│         └─→ User responds with approve/reject                               │
│                                                                             │
│  4. Process Result                                                          │
│     └─→ Approve → Apply modification → Update Evolution                     │
│     └─→ Reject → Record reason → Update status                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## User Commands

### Review Notification

When a session starts, if there are pending review requests, the system automatically displays a notification:

```
📬 You have **2** pending evolution reviews.

📋 **Pending Reviews** (2 total):

**1. Prompt Optimization**
   Type: prompt_optimization
   ID: `prompt-123`
   Created: 2026-03-23 10:30:00
   Description: Learning identified better phrasing from successful sessions...

   Commands: `approve prompt-123` | `reject prompt-123 <reason>`

**2. Skill Code Fix**
   Type: skill_code_fix
   ID: `skill-456`
   Created: 2026-03-23 09:15:00
   Description: Remove console.log statements from skill code...

   Commands: `approve skill-456` | `reject skill-456 <reason>`

_...and 0 more. Use `list reviews` to see all._
```

### Review Commands

| Command | Description | Example |
|------|------|------|
| `approve <id>` | Approve and apply modification | `approve prompt-123` |
| `yes` | Approve currently displayed review | `yes` |
| `ok` | Approve currently displayed review | `ok` |
| `reject <id> <reason>` | Reject modification with reason | `reject prompt-123 not needed` |
| `no` | Reject currently displayed review | `no` |
| `list reviews` | Show all pending review requests | `list reviews` |
| `show pending` | Show pending review requests | `show pending` |

### Command Responses

**Approve Success**:
```
✓ Proposal approved and applied successfully
```

**Reject Success**:
```
✗ Proposal rejected: not needed
```

**List Reviews**:
```
📋 **Pending Reviews** (3 total):

**1. Prompt Optimization**
   Type: prompt_optimization
   ID: `prompt-123`
   ...
```

## Integration Points

### 1. Session Start

**File**: `packages/opencode/src/session/prompt.ts`

```typescript
if (step === 1) {
  // Check for pending reviews and notify user at session start
  const reviewNotification = await handleReviewNotification()
  if (reviewNotification) {
    // Present review notification as a system message
    log.info("review_notification_presented", { sessionID })
  }
}
```

### 2. User Message Processing

```typescript
// Check if user message is a review command
const userText = msgs
  .filter((m) => m.info.role === "user")
  .flatMap((m) => m.parts)
  .filter((p) => p.type === "text")
  .map((p) => ("text" in p ? p.text : ""))
  .join(" ")

if (userText) {
  const reviewResult = await handleReviewCommand(userText)
  if (reviewResult.isReview) {
    // Handle review command response
    if (reviewResult.response) {
      log.info("review_command_processed", {
        sessionID,
        action: reviewResult.action,
        response: reviewResult.response,
      })
    }
  }
}
```

### 3. Auto-Present

```typescript
// Present pending review if any (auto-present on first step)
if (step === 1) {
  const presented = await handleReviewPresentation()
  if (presented) {
    log.info("review_presented", { sessionID })
    // User will respond with approve/reject command
  }
}
```

## Core Components

### handlers.ts

**File**: `packages/opencode/src/session/handlers.ts`

```typescript
// Review notification
export async function handleReviewNotification(): Promise<string | null>

// Process review command
export async function handleReviewCommand(
  userInput: string,
): Promise<{
  isReview: boolean
  response?: string
  action?: "approved" | "rejected"
}>

// Present review request
export async function handleReviewPresentation(
  ctx?: LoopContext,
): Promise<boolean>
```

### in-session-review.ts

**File**: `packages/opencode/src/session/in-session-review.ts`

Main functions:

```typescript
// In-session review handling
export async function handleInSessionReview(
  ctx?: LoopContext,
  options?: ReviewDisplayOptions,
): Promise<ReviewHandlerResult>

// Process user review decision
export async function processUserReviewDecision(
  userInput: string,
): Promise<{
  success: boolean
  action?: "approved" | "rejected"
  proposal_id?: string
  error?: string
  message?: string
}>

// Check if review command
export function isReviewCommand(userInput: string): boolean

// Get formatted pending reviews list
export async function getPendingReviewsFormatted(
  maxReviews?: number,
): Promise<{
  hasPending: boolean
  count: number
  formatted: string
}>
```

## Configuration Options

### ReviewDisplayOptions

```typescript
interface ReviewDisplayOptions {
  /** Maximum reviews to display */
  maxReviews?: number  // Default: 3

  /** Show review details */
  showDetails?: boolean  // Default: true

  /** Auto-present if only one pending */
  autoPresent?: boolean  // Default: true
}
```

## Session Flow Examples

### Complete Session Flow

```
User: Help me optimize this TypeScript code

[Session Start]
  ↓
[Check pending reviews] → Found 1 pending review
  ↓
[Auto-present review]
  ↓
Assistant:
  🔍 **Evolution Modification Proposal**

  **Type:** prompt_optimization
  **Target:** Code Helper Prompt
  **ID:** `prompt-123`

  **Description:**
  Learning identified better phrasing from successful sessions...

  **Actions:**
  - `approve prompt-123` - Apply this modification
  - `reject prompt-123 <reason>` - Reject with reason

  > Reply with your decision or continue the conversation to defer.

User: approve prompt-123
  ↓
[Process approval command]
  ↓
[Apply modification]
  ↓
Assistant: ✓ Proposal approved and applied successfully

[Continue normal session flow]
Assistant: Sure, I'll help you optimize this TypeScript code...
```

### List All Reviews

```
User: list reviews

Assistant:
  📋 **Pending Reviews** (5 total):

  **1. Prompt Optimization**
     Type: prompt_optimization
     ID: `prompt-123`
     ...

  **2. Skill Code Fix**
     Type: skill_code_fix
     ID: `skill-456`
     ...

  [More reviews...]
```

### Reject Review

```
User: reject prompt-123 not needed at this time

Assistant: ✗ Proposal rejected: not needed at this time
```

## State Management

Review state is persisted in the following locations:

1. **Proposal Files**: `.opencode/evolution/proposals/<id>.json`
2. **Review State**: In-memory `Map<string, EvolutionReviewRequest>`
3. **Session State**: Tracked via log (not persisted)

## Error Handling

### Review Not Found

```
Error: Proposal not found
```

### Review Already Processed

```
Error: Proposal already approved/rejected
```

### Safety Cooldown

```
Error: Cannot submit for review: Cooldown period active.
Remaining: 23h 45m
```

## Comparison with CLI Review

| Feature | In-Session Review | CLI Review |
|------|-----------|---------|
| **Interaction** | Natural language dialog | Command-line arguments |
| **Context** | Within session context | Standalone command |
| **Notification** | Automatic | Manual check required |
| **Convenience** | High (no context switch) | Medium |
| **Use Case** | Daily development sessions | Batch processing/scripts |

## Best Practices

### 1. Review Promptly

Check review notifications at session start and process pending requests timely.

### 2. Provide Rejection Reasons

When rejecting a review, provide specific reasons to help improve future suggestions:

```bash
reject prompt-123 current prompt is already good enough
```

### 3. Use list reviews

Regularly use `list reviews` to check all pending reviews and avoid backlog.

### 4. Defer Review

If you don't want to review immediately, you can continue the conversation. Reviews will be shown again in the next session.

## Related Files

- `packages/opencode/src/session/in-session-review.ts` - Core review handling logic
- `packages/opencode/src/session/handlers.ts` - Session handlers integration
- `packages/opencode/src/session/prompt.ts` - Session loop integration
- `packages/opencode/src/learning/feedback-loop.ts` - FeedbackLoop API
