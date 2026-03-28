# Learning Module Security Enhancements

Implementation of 4 security enhancements based on tou.txt requirements.

## 1. Enhanced Test Coverage (Mutation Testing)

**File**: `src/learning/skill-validator.ts`

### Features Implemented

- ✅ New `runMutationTesting()` method
- ✅ Supports 4 mutation types:
  - Return value removal
  - Condition replacement
  - Operator replacement
  - Equality inversion
- ✅ Mutation score threshold: 70%
- ✅ Automatic mutation testing to detect test case quality

### Code Example

```typescript
async runMutationTesting(skillCode: string, testCases) {
  const mutations = this.generateMutations(skillCode)
  let killedMutants = 0

  for (const mutant of mutations) {
    const testResults = await this.runTests(mutant.code, testCases)
    if (!testResults.every(r => r.passed)) {
      killedMutants++ // Test detected mutation
    }
  }

  const score = killedMutants / mutations.length
  return { score, passed: score >= 0.7 }
}
```

---

## 2. Improved Dependency Management

**File**: `src/learning/installer.ts`

### Features Implemented

- ✅ `extractImports()` - Extract all import statements from code
- ✅ `checkMissingDependencies()` - Check for undeclared npm dependencies
- ✅ New install type `pending_deps` - Mark skills with missing dependencies
- ✅ Automatic detection of dependencies and devDependencies in package.json

### Detection Logic

```typescript
// Extract import statements
const imports = this.extractImports(skillCode)

// Check for missing dependencies
const missingDeps = await this.checkMissingDependencies(imports)

if (missingDeps.length > 0) {
  return {
    success: false,
    type: "pending_deps",
    missing_deps: missingDeps,
  }
}
```

---

## 3. Strengthened Human Feedback Loop

**Files**: `src/learning/command.ts`, `src/learning/negative.ts`

### Features Implemented

- ✅ Automatically record rejected skills to Negative Memory
- ✅ Analyze skill features (source domain, tags, keywords)
- ✅ Reduce scoring weight for future content from similar sources
- ✅ Feature extraction: source, domain, tags, title_keywords

### Feedback Recording

```typescript
async function recordSkillRejection(result, analyzed) {
  const features = {
    source: rejectedItem.source,
    domain: extractDomain(rejectedItem.url),
    tags: rejectedItem.tags,
    title_keywords: rejectedItem.title.toLowerCase().split(" "),
  }

  await negativeMemory.recordFailure({
    failure_type: "install_failed",
    context: {
      reason: result.error,
      source: features.source,
      domain: features.domain,
      tags: features.tags,
    },
    blocked_items: [rejectedItem.url, rejectedItem.title],
  })
}
```

---

## 4. Refined Sandbox Resource Limits (Syscall Filtering)

**File**: `src/learning/skill-sandbox.ts`

### Features Implemented

- ✅ `DANGEROUS_PATTERNS` blacklist - 29 dangerous patterns
- ✅ `detectDangerousPatterns()` - Code scanning
- ✅ `SAFE_GLOBALS` - Safe vm context
- ✅ `executeInVM()` - Isolated execution using Node.js vm module

### Dangerous Patterns List

```typescript
const DANGEROUS_PATTERNS = [
  "child_process", // Child processes
  "exec",
  "execSync", // Command execution
  "spawn",
  "spawnSync", // Process spawning
  "eval(",
  "Function(", // Code injection
  "fs.readFile", // File system access
  "process.env", // Environment variables
  "/etc/passwd", // Sensitive paths
  "~/.ssh",
  ".env", // Credential files
]
```

### Execution Flow

```
1. Detect dangerous patterns → Reject immediately if found
2. Create vm sandbox context → Expose only safe globals
3. Execute skill code in isolated environment
4. Auto-terminate on timeout
```

---

## Testing & Verification

### Run Tests

```bash
cd packages/opencode
bun test
```

### Verification Points

1. ✅ Mutation Testing: Skills with mutation score < 70% are rejected
2. ✅ Dependency Check: Skills with missing dependencies return `pending_deps`
3. ✅ Feedback Loop: Rejected skills are recorded to negative memory
4. ✅ Syscall Filter: Code with dangerous patterns is blocked

---

## Configuration

### opencode.json Settings

```json
{
  "evolution": {
    "disableSkillGeneration": false,
    "embedding": {
      "provider": "dashscope",
      "model": "text-embedding-v4"
    }
  }
}
```

### Environment Variables

```bash
# Bash
export EMBEDDING_MODEL="dashscope/text-embedding-v4"

# Fish
set -g EMBEDDING_MODEL "dashscope/text-embedding-v4"
```

---

## Modified Files

| File                 | Changes                   | Lines Added |
| -------------------- | ------------------------- | ----------- |
| `skill-validator.ts` | Mutation Testing          | +90         |
| `installer.ts`       | Dependency Detection      | +65         |
| `command.ts`         | Feedback Loop Enhancement | +55         |
| `skill-sandbox.ts`   | Syscall Filtering         | +85         |

---

## Security Enhancement Summary

| Enhancement       | Protects Against         | Risk Level | Status      |
| ----------------- | ------------------------ | ---------- | ----------- |
| Mutation Testing  | Low-quality tests        | Medium     | ✅ Complete |
| Dependency Check  | Undeclared dependencies  | High       | ✅ Complete |
| Feedback Loop     | Repeated failures        | Medium     | ✅ Complete |
| Syscall Filtering | Malicious code execution | High       | ✅ Complete |

---

## Future Recommendations

1. **Whitelist Mechanism**: Allow skills from trusted sources to skip certain checks
2. **Dynamic Blacklist Learning**: Automatically adjust DANGEROUS_PATTERNS based on user behavior
3. **Resource Quota Management**: Limit CPU/memory usage per skill
4. **Audit Logging**: Record all security check decisions for traceability
