---
name: zeroclaw
description: ZeroClaw (Rust AI Agent Runtime) - 启动、配对、配置、操作
metadata:
  zeroclaw: true
---

# ZeroClaw 操作指南

ZeroClaw 是一个 Rust 编写的轻量级 AI Agent 运行时，支持工具执行、安全沙箱、紧急停止等功能。

---

## 快速开始

### 1. 启动 ZeroClaw

```bash
# 方式一：直接运行（随机端口）
zeroclaw

# 方式二：指定端口
zeroclaw --port 42617

# 方式三：后台运行
zeroclaw --port 42617 &
```

### 2. 配对（首次）

首次启动会显示配对码，访问 Web UI 完成配对：

```
http://127.0.0.1:42617
```

配对后会获得 token，格式：`zc_xxx`

### 3. 配置 OpenCode

**方式一：环境变量**

```bash
export ZEROCLAW_URL=http://127.0.0.1:42617
export ZEROCLAW_TOKEN=zc_xxx
```

**方式二：opencode.json**

```json
{
  "zeroclaw": {
    "enabled": true,
    "url": "http://127.0.0.1:42617",
    "token": "zc_xxx"
  }
}
```

---

## 常用操作

### 检查状态

```bash
# 健康检查
curl http://127.0.0.1:42617/health \
  -H "Authorization: Bearer zc_xxx"
```

### 紧急停止 (E-Stop)

| 级别           | 说明         |
| -------------- | ------------ |
| `none`         | 禁用         |
| `tool-freeze`  | 冻结工具执行 |
| `domain-block` | 阻止特定域   |
| `network-kill` | 禁用网络     |
| `kill-all`     | 全部停止     |

```bash
# 触发紧急停止
curl -X POST http://127.0.0.1:42617/estop/engage \
  -H "Authorization: Bearer zc_xxx" \
  -H "Content-Type: application/json" \
  -d '{"level": "tool-freeze"}'

# 解除紧急停止（需要 OTP）
curl -X POST http://127.0.0.1:42617/estop/release \
  -H "Authorization: Bearer zc_xxx" \
  -H "Content-Type: application/json" \
  -d '{"otp": "xxx"}'
```

---

## OpenCode 集成

### 可用工具

ZeroClaw 可用时自动注册以下工具：

| 工具                     | 说明                          |
| ------------------------ | ----------------------------- |
| `zeroclaw_shell`         | 通过 ZeroClaw 执行 shell 命令 |
| `zeroclaw_file_read`     | 通过 ZeroClaw 读取文件        |
| `zeroclaw_file_write`    | 通过 ZeroClaw 写入文件        |
| `zeroclaw_http_request`  | 通过 ZeroClaw 发送 HTTP 请求  |
| `zeroclaw_memory_store`  | 存储到 ZeroClaw 记忆          |
| `zeroclaw_memory_recall` | 从 ZeroClaw 记忆检索          |
| `zeroclaw_status`        | 查看 ZeroClaw 状态            |
| `zeroclaw_estop`         | 紧急停止控制                  |

### 配置路由

在 `opencode.json` 中配置工具路由：

```json
{
  "zeroclaw": {
    "enabled": true,
    "url": "http://127.0.0.1:42617",
    "token": "zc_xxx",
    "routing": {
      "shell": true,
      "file": true,
      "http": true,
      "memory": false,
      "cron": false
    },
    "security": {
      "policy": "supervised",
      "estopEnabled": true
    }
  }
}
```

---

## API 参考

### Chat API

```bash
curl -X POST http://127.0.0.1:42617/api/chat \
  -H "Authorization: Bearer zc_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "say hello",
    "model": "z-ai/glm-4.5-air:free"
  }'
```

### 工具执行

```bash
# 直接执行工具
curl -X POST http://127.0.0.1:42617/tools/exec \
  -H "Authorization: Bearer zc_xxx" \
  -H "Content-Type: application/json" \
  -H "X-Security-Policy: supervised" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tool.execute",
    "params": {
      "name": "shell",
      "args": {"command": "echo hello"}
    }
  }'
```

---

## 故障排除

### 问题：无法连接

1. 确认 ZeroClaw 正在运行：`ps aux | grep zeroclaw`
2. 检查端口是否正确：`curl http://127.0.0.1:42617/health`
3. 确认 token 有效

### 问题：配对码失效

重新启动 ZeroClaw 获取新配对码：

```bash
zeroclaw --port 42617
```

### 问题：工具执行失败

OpenCode 会自动降级到 chat API 执行。

---

## 相关信息

- ZeroClaw 仓库：https://github.com/anomalyco/zeroclaw
