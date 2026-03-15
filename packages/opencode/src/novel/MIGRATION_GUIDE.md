# 硬编码改进迁移指南

## 概述

本文档指导如何将 Novel Engine 中的硬编码内容迁移到新的配置化和动态化系统。

---

## 已完成 ✅

### 1. 统一配置系统

**文件：** `config.ts`

**功能：**

- 难度等级配置（easy/normal/hard/nightmare）
- 故事类型权重（action/character/theme/balanced）
- 提示词风格（concise/balanced/creative）

**使用示例：**

```typescript
import { novelConfigManager } from "./config"

// 加载配置
await novelConfigManager.load()

// 获取难度预设
const difficulty = novelConfigManager.getDifficultyPreset()
console.log(difficulty.stressThresholds.critical) // 90 (normal)

// 获取故事类型权重
const weights = novelConfigManager.getStoryTypeWeights()
console.log(weights.tensionLevel) // 0.15 (balanced)

// 更新配置
novelConfigManager.update({
  difficulty: "hard",
  storyType: "action",
})

// 保存配置
await novelConfigManager.save()
```

**配置文件格式：**

```json
{
  "difficulty": "normal",
  "storyType": "balanced",
  "promptStyle": {
    "verbosity": "balanced",
    "creativity": 0.7,
    "structureStrictness": 0.5,
    "allowDeviation": true
  }
}
```

---

### 2. 动态提示词构建器

**文件：** `dynamic-prompt.ts`

**功能：**

- 基于模板构建提示词
- 自动注入故事基调指令
- 自动注入风格指令
- 支持自定义变量

**使用示例：**

```typescript
import { createPromptBuilder } from "./dynamic-prompt"

// 创建提示词构建器
const builder = createPromptBuilder("stateEvaluation")

// 设置故事基调
builder.withTone({
  genre: "dark fantasy",
  mood: "tense",
  pacing: "fast",
  contentRating: "mature",
  themes: ["sacrifice", "redemption"],
  style: "descriptive",
})

// 设置变量并构建
const prompt = builder.withVariables({ STORY_SEGMENT: storyText }).build()
```

**预定义模板：**

- `stateEvaluation` - 状态变更评估
- `chaosEvent` - 混乱事件生成
- `characterAnalysis` - 角色心理分析
- `branchGeneration` - 分支生成

---

## 待完成 🔲

### 1. 更新 evolution-rules.ts

**当前状态：** 使用硬编码提示词模板

**迁移步骤：**

```typescript
// 旧代码
const prompt = STATE_CHANGE_EVALUATION_PROMPT.replace("{{STORY_SEGMENT}}", storyText)

// 新代码
import { createPromptBuilder } from "./dynamic-prompt"
import { novelConfigManager } from "./config"

const config = novelConfigManager.getConfig()
const builder = createPromptBuilder("stateEvaluation", config.promptStyle)

if (storyTone) {
  builder.withTone(storyTone)
}

const prompt = builder.withVariables({ STORY_SEGMENT: storyText }).build()
```

**文件位置：** `evolution-rules.ts:117-130`

---

### 2. 更新 branch-manager.ts 评分权重

**当前状态：** 硬编码权重

```typescript
// 旧代码
const weights = {
  narrativeQuality: 0.25,
  tensionLevel: 0.15,
  characterDevelopment: 0.2,
  plotProgression: 0.15,
  characterGrowth: 0.1,
  riskReward: 0.05,
  thematicRelevance: 0.1,
}
```

**迁移步骤：**

```typescript
// 新代码
import { novelConfigManager } from "./config"

const weights = novelConfigManager.getStoryTypeWeights()

// 现在权重会根据故事类型自动调整
// action: tensionLevel = 0.30
// character: characterDevelopment = 0.35
// theme: thematicRelevance = 0.30
```

**文件位置：** `branch-manager.ts:82-95`

---

### 3. 更新阈值常量

**当前状态：** 硬编码阈值

```typescript
// 旧代码
private static readonly STRESS_THRESHOLD_CRITICAL = 90
private static readonly STRESS_THRESHOLD_HIGH = 70
```

**迁移步骤：**

```typescript
// 新代码
import { novelConfigManager } from "./config"

const thresholds = novelConfigManager.getDifficultyPreset().stressThresholds

const STRESS_THRESHOLD_CRITICAL = thresholds.critical // 90 (normal) or 80 (hard)
const STRESS_THRESHOLD_HIGH = thresholds.high // 70 (normal) or 60 (hard)
```

**文件位置：** `evolution-rules.ts:85-86`

---

### 4. 更新 character-deepener.ts

**当前状态：** 静态提示词

**迁移步骤：**

```typescript
// 新代码
import { createPromptBuilder } from "./dynamic-prompt"
import { novelConfigManager } from "./config"

const config = novelConfigManager.getConfig()
const builder = createPromptBuilder("characterAnalysis", config.promptStyle)

if (storyTone) {
  builder.withTone(storyTone)
}

const prompt = builder.withVariables({ CHARACTER_STATE: characterStateJson }).build()
```

**文件位置：** `character-deepener.ts:112-150`

---

## 配置示例

### 动作故事配置

```json
{
  "difficulty": "hard",
  "storyType": "action",
  "promptStyle": {
    "verbosity": "concise",
    "creativity": 0.6,
    "structureStrictness": 0.4,
    "allowDeviation": true
  }
}
```

**效果：**

- 压力阈值更低（critical: 80, high: 60）
- 紧张度权重更高（0.30 vs 0.15）
- 分支数量更少（10 vs 20）
- 创伤更频繁（1.5x）

---

### 角色驱动故事配置

```json
{
  "difficulty": "normal",
  "storyType": "character",
  "promptStyle": {
    "verbosity": "detailed",
    "creativity": 0.8,
    "structureStrictness": 0.3,
    "allowDeviation": true
  }
}
```

**效果：**

- 角色发展权重最高（0.35）
- 提示词更详细
- 创造性更高
- 结构限制更少

---

### 主题驱动故事配置

```json
{
  "difficulty": "easy",
  "storyType": "theme",
  "promptStyle": {
    "verbosity": "balanced",
    "creativity": 0.7,
    "structureStrictness": 0.5,
    "allowDeviation": false
  }
}
```

**效果：**

- 主题相关性权重最高（0.30）
- 压力阈值更高（critical: 100）
- 分支数量更多（30）
- 技能获取更频繁（1.5x）

---

## 最佳实践

### 1. 使用预设而非自定义

```typescript
// ✅ 推荐：使用预设
novelConfigManager.update({
  difficulty: "hard",
  storyType: "action",
})

// ⚠️ 避免：手动配置所有权重
novelConfigManager.update({
  customWeights: {
    narrativeQuality: 0.2,
    tensionLevel: 0.3,
    // ... 手动配置所有 7 个权重
  },
})
```

### 2. 加载配置后再使用

```typescript
// ✅ 推荐
await novelConfigManager.load()
const config = novelConfigManager.getConfig()

// ⚠️ 避免：未加载就使用
const config = novelConfigManager.getConfig() // 可能是默认值
```

### 3. 保存用户偏好

```typescript
// 用户首次设置后保存
novelConfigManager.update({
  difficulty: "normal",
  storyType: "balanced",
})
await novelConfigManager.save()

// 后续会话自动加载
await novelConfigManager.load()
```

### 4. 故事基调与配置分离

```typescript
// 配置：持久的用户偏好
novelConfigManager.update({
  storyType: "action", // 类型
  difficulty: "normal", // 难度
})

// 基调：单个故事的特定设置
const storyTone = {
  genre: "cyberpunk", // 具体类型
  mood: "dark", // 情绪
  pacing: "fast", // 节奏
  // ...
}

// 使用
builder.withTone(storyTone)
```

---

## 迁移检查清单

- [ ] 安装新模块（config.ts, dynamic-prompt.ts）
- [ ] 更新 evolution-rules.ts 使用动态提示词
- [ ] 更新 branch-manager.ts 使用配置权重
- [ ] 更新 character-deepener.ts 使用动态提示词
- [ ] 更新 orchestrator.ts 加载配置
- [ ] 创建默认配置文件
- [ ] 测试不同配置组合
- [ ] 更新文档

---

## 故障排除

### 配置加载失败

**问题：** `novel_config_load_failed`

**解决：**

```typescript
try {
  await novelConfigManager.load()
} catch (error) {
  // 自动使用默认配置
  console.log("Using default configuration")
}
```

### 提示词模板未知

**问题：** `Unknown template: xxx`

**解决：** 检查模板 ID 是否在 `PROMPT_TEMPLATES` 中定义

### 权重和不等于 1

**问题：** 分支评分异常

**解决：** 验证自定义权重：

```typescript
const weights = novelConfigManager.getStoryTypeWeights()
const sum = Object.values(weights).reduce((a, b) => a + b, 0)
console.assert(Math.abs(sum - 1.0) < 0.001, "Weights must sum to 1")
```

---

## 性能考虑

### 配置加载

- 首次加载：~10ms（读取文件）
- 后续访问：~0ms（内存缓存）

### 提示词构建

- 简单替换：~1ms
- 注入基调指令：~2ms
- 总体影响：可忽略不计

### 建议

- ✅ 在应用启动时加载配置
- ✅ 复用配置对象而非重复加载
- ✅ 提示词构建在 LLM 调用前进行

---

## 后续计划

### Phase 1 (已完成)

- ✅ 统一配置系统
- ✅ 动态提示词构建器
- ✅ 预定义模板

### Phase 2 (进行中)

- 🔲 更新所有模块使用新系统
- 🔲 添加配置 UI
- 🔲 添加配置验证

### Phase 3 (计划中)

- 🔲 运行时配置热更新
- 🔲 配置导入/导出
- 🔲 配置分享功能

---

_Last updated: 2026-03-15_
_Novel Engine Hardcoding Migration Guide_
