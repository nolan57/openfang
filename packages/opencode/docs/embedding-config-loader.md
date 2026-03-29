# Embedding 配置加载器使用指南

## 概述

统一的 Embedding 配置加载系统，按优先级逐级读取配置，直到找到可用配置为止。完全支持中文环境和 Fish Shell。

## 配置优先级（从高到低）

```
1️⃣ 显式参数 (explicit) - 代码中直接传入
   ↓
2️⃣ 环境变量 (env) - process.env 或 Bun.env
   ↓
3️⃣ .env 文件 (dotenv) - 项目或用户目录
   ↓
4️⃣ 配置文件 (config-file) - opencode.jsonc/json
   ↓
5️⃣ 默认配置 (default) - 内置默认值
```

## 快速开始

### 方法 1: 环境变量（推荐用于开发）

**Bash/Zsh:**

```bash
# ~/.bashrc 或 ~/.zshrc
export DASHSCOPE_API_KEY="sk-your-actual-key"
export EMBEDDING_MODEL="text-embedding-v4"
export EMBEDDING_DIM="1536"
```

**Fish Shell:**

```fish
# ~/.config/fish/config.fish
set -x DASHSCOPE_API_KEY "sk-your-actual-key"
set -x EMBEDDING_MODEL "text-embedding-v4"
set -x EMBEDDING_DIM "1536"
```

### 方法 2: .env 文件（跨 Shell 通用，推荐）

在项目根目录或用户配置目录创建 `.env` 文件：

```bash
# 项目根目录/..env
DASHSCOPE_API_KEY=sk-your-actual-key
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIM=1536
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

**支持的位置：**

- `./.env` - 当前项目
- `./.env.local` - 当前项目（不提交到 Git）
- `~/.config/opencode/.env` - 用户级配置（所有项目共享）
- `~/.opencode/.env` - 用户级配置（旧版）

### 方法 3: 配置文件（推荐用于生产）

创建 `opencode.jsonc` 或 `opencode.json`：

```jsonc
{
  "embedding": {
    "model": "text-embedding-v4",
    "apiKey": "sk-your-actual-key",
    "dimensions": 1536,
    "baseURL": "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
}
```

**支持的位置：**

- `./opencode.jsonc` - 当前项目
- `./opencode.json` - 当前项目
- `~/.config/opencode/opencode.jsonc` - 用户级配置
- `~/.config/opencode/opencode.json` - 用户级配置
- `~/.opencode/opencode.jsonc` - 用户级配置（旧版）
- `~/.opencode/opencode.json` - 用户级配置（旧版）

### 方法 4: 代码中显式传入

```typescript
import { embedWithDimensions } from "./learning/embed-utils"

const vector = await embedWithDimensions({
  model: "text-embedding-v4",
  value: "Hello, 世界！",
  dimensions: 1536,
  apiKey: "sk-your-actual-key", // 显式传入
})
```

## 使用示例

### 示例 1: 基本的文本向量化

```typescript
import { embedWithDimensions } from "./learning/embed-utils"

// 配置会自动从环境变量/.env/配置文件加载
const vector = await embedWithDimensions({
  model: "text-embedding-v4",
  value: "人工智能是计算机科学的一个分支",
  dimensions: 1536,
})

console.log(`向量维度：${vector.length}`) // 1536
```

### 示例 2: 加载配置并查看来源

```typescript
import { loadEmbeddingConfig, getEmbeddingConfigLoader } from "./learning/embedding-config-loader"

const loader = getEmbeddingConfigLoader()
const config = await loader.loadConfig()

console.log("配置详情:", {
  模型：config.model,
  维度：config.dimensions,
  来源：loader.getConfigSource(config), // "环境变量" | ".env 文件" | "配置文件" | "显式参数" | "默认配置"
  是否有 API 密钥：!!config.apiKey,
})
```

### 示例 3: 仅获取 API Key

```typescript
import { getEmbeddingApiKey } from "./learning/embedding-config-loader"

try {
  const apiKey = await getEmbeddingApiKey()
  console.log("✅ API Key 已加载")
} catch (error) {
  console.error("❌ API Key 未配置:", error.message)
  // 会显示详细的配置指南
}
```

### 示例 4: 覆盖部分配置

```typescript
import { loadEmbeddingConfig } from "./learning/embedding-config-loader"

// 其他配置从环境变量/配置文件加载，只覆盖维度
const config = await loadEmbeddingConfig({
  dimensions: 3072, // 使用更大的维度
})
```

### 示例 5: 验证配置

```typescript
import { getEmbeddingConfigLoader } from "./learning/embedding-config-loader"

const loader = getEmbeddingConfigLoader()
const config = await loader.loadConfig()

const isValid = await loader.validateConfig(config)
if (isValid) {
  console.log("✅ Embedding 配置有效，API 可访问")
} else {
  console.log("❌ Embedding 配置无效")
}
```

## 支持的配置项

### API Key（必需）

支持以下环境变量名称（按优先级）：

- `DASHSCOPE_API_KEY`（主要）
- `OPENCODE_EMBEDDING_API_KEY`（备选）
- `EMBEDDING_API_KEY`（备选）

### 模型配置

- `EMBEDDING_MODEL` - Embedding 模型名称
  - 默认：`text-embedding-v4`
  - 其他选项：`text-embedding-v3`

- `EMBEDDING_DIM` - 向量维度
  - 默认：`1536`
  - 其他选项：`3072`（text-embedding-v3 大模型）

- `DASHSCOPE_BASE_URL` - API 基础地址
  - 默认：`https://dashscope.aliyuncs.com/compatible-mode/v1`

## 配置来源说明

| 来源      | 说明                      | 优先级 |
| --------- | ------------------------- | ------ |
| 显式参数  | 代码中直接传入的参数      | 最高   |
| 环境变量  | Shell 或系统环境变量      | 高     |
| .env 文件 | 项目或用户目录的.env 文件 | 中     |
| 配置文件  | opencode.jsonc/json       | 低     |
| 默认配置  | 内置默认值                | 最低   |

## Shell 兼容性

### Bash / Zsh

```bash
# 编辑配置文件
nano ~/.bashrc  # 或 ~/.zshrc

# 添加配置
export DASHSCOPE_API_KEY="sk-your-key"

# 使配置生效
source ~/.bashrc
```

### Fish Shell

```fish
# 编辑配置文件
nano ~/.config/fish/config.fish

# 添加配置（注意使用 set -x）
set -x DASHSCOPE_API_KEY "sk-your-key"

# 使配置生效
source ~/.config/fish/config.fish
```

### 跨 Shell 通用（强烈推荐）

使用 `.env` 文件或 `opencode.jsonc` 配置文件，避免不同 Shell 的差异问题。

## 错误处理

### 错误：API Key 未配置

如果所有来源都未配置 API Key，会抛出详细的错误信息：

```
DASHSCOPE_API_KEY 未配置！请通过以下方式之一设置:
  1. 环境变量：export DASHSCOPE_API_KEY=your-key
  2. .env 文件：在项目或 ~/.config/opencode/.env 中添加 DASHSCOPE_API_KEY=your-key
  3. 配置文件：在 opencode.jsonc 的 embedding.apiKey 字段中配置
  4. 显式参数：在代码中传入 apiKey 参数
```

### 错误：API Key 无效

```
DashScope API 错误：401 {"error":{"message":"Incorrect API key provided"}}
```

**解决方案：**

1. 检查 API Key 是否正确复制（包含完整的 `sk-` 前缀）
2. 登录阿里云 DashScope 控制台验证 API Key 状态
3. 确认 API Key 未过期

## 最佳实践

### 1. 开发环境

使用 `.env.local` 文件（不提交到 Git）：

```bash
# .env.local
DASHSCOPE_API_KEY=sk-dev-key
```

```gitignore
# .gitignore
.env.local
```

### 2. 生产环境

使用环境变量或配置文件：

```bash
# Docker / K8s
env:
  - name: DASHSCOPE_API_KEY
    valueFrom:
      secretKeyRef:
        name: dashscope-secret
        key: api-key
```

### 3. 团队协作

提供 `.env.example` 模板：

```bash
# .env.example
DASHSCOPE_API_KEY=sk-your-key-here
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIM=1536
```

### 4. 多项目管理

使用用户级配置文件 `~/.config/opencode/.env`，所有项目共享同一个 API Key。

## 测试

运行配置加载器测试：

```bash
cd packages/opencode
bun test src/learning/embedding-config-loader.test.ts --timeout 30000
```

运行实际 API 调用测试（需要有效的 API Key）：

```bash
export DASHSCOPE_API_KEY=sk-your-actual-key
bun test src/learning/embedding-config-loader.test.ts --timeout 30000
```

## 已集成的模块

以下模块已统一使用新的配置加载器：

- ✅ `src/learning/embed-utils.ts` - `embedWithDimensions()`
- ✅ `src/learning/embedding-service.ts` - `EmbeddingService.createService()`
- ✅ `src/tool/code-index.ts` - 代码索引

所有 Embedding 调用现在都遵循统一的配置加载逻辑。

## 常见问题

### Q: 为什么我的环境变量不生效？

**A:** 检查以下几点：

1. Fish Shell 不使用 `.zshrc`，请使用 `~/.config/fish/config.fish`
2. 使用 `echo $DASHSCOPE_API_KEY` 确认变量已设置
3. 重启终端或运行 `source` 命令使配置生效

### Q: 如何确认配置从哪里加载的？

**A:** 使用 `getConfigSource()` 方法：

```typescript
const config = await loadEmbeddingConfig()
const loader = getEmbeddingConfigLoader()
console.log("配置来源:", loader.getConfigSource(config))
// 输出：环境变量 / .env 文件 / 配置文件 / 显式参数 / 默认配置
```

### Q: 可以在运行时切换 API Key 吗？

**A:** 可以，使用显式参数：

```typescript
const vector = await embedWithDimensions({
  model: "text-embedding-v4",
  value: "文本",
  apiKey: "sk-another-key", // 临时使用其他 API Key
})
```

## 相关文档

- [DashScope 官方文档](https://help.aliyun.com/zh/model-studio/)
- [Embedding 模型文档](https://help.aliyun.com/zh/model-studio/text-embedding/)
- 代码实现：`src/learning/embedding-config-loader.ts`
