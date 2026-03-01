# plugin-qqbot 与 qqbot 对比分析

## 项目结构对比

| 文件             | qqbot (参考)    | plugin-qqbot (当前) |
| ---------------- | --------------- | ------------------- |
| api.ts           | ✅ 完整封装     | ✅ 基础实现         |
| gateway.ts       | ✅ 完整功能     | ⚠️ 简化版           |
| outbound.ts      | ✅ 完善消息队列 | ⚠️ 简化版           |
| types.ts         | ✅ 完整类型     | ✅ 基础类型         |
| session-store.ts | ✅ 持久化存储   | ❌ 无               |
| known-users.ts   | ✅ 用户记录     | ❌ 无               |
| runtime.ts       | ✅ 运行时状态   | ❌ 无               |
| image-server.ts  | ✅ 图片服务     | ❌ 无               |
| utils/\*         | ✅ 工具函数     | ❌ 无               |

---

## 功能对比详情

### 1. API 层

| 功能               | qqbot                    | plugin-qqbot    | 状态   |
| ------------------ | ------------------------ | --------------- | ------ |
| Token singleflight | ✅ 防止并发重复获取      | ❌ 简单缓存     | 需改进 |
| Markdown 支持      | ✅ initApiConfig 配置    | ⚠️ 已配置未实现 | 完善   |
| 统一 apiRequest    | ✅ 统一错误处理          | ❌ 直接 fetch   | 改进   |
| msg_seq 生成       | ✅                       | ✅              | 已完成 |
| 富媒体上传         | ✅ uploadC2CMedia        | ❌ 无           | 需添加 |
| 图片消息发送       | ✅ sendC2CMediaMessage   | ❌ 无           | 需添加 |
| 语音消息发送       | ✅ sendGroupMediaMessage | ❌ 无           | 需添加 |

### 2. Outbound 层

| 功能              | qqbot       | plugin-qqbot    | 状态   |
| ----------------- | ----------- | --------------- | ------ |
| 图片标签处理      | ✅ 完整     | ⚠️ 简单替换文本 | 完善   |
| 本地图片转 Base64 | ✅          | ❌ 无           | 需添加 |
| 远程图片 URL      | ✅          | ⚠️ 仅文本提示   | 完善   |
| 消息发送队列      | ✅ 顺序发送 | ❌ 无           | 需添加 |
| 返回 messageId    | ✅          | ❌ void         | 需改进 |
| 错误恢复          | ✅ 详细     | ❌ 简单抛出     | 改进   |

### 3. Gateway 层 (消息接收)

| 功能              | qqbot                 | plugin-qqbot | 状态   |
| ----------------- | --------------------- | ------------ | ------ |
| attachments 解析  | ✅ 处理图片/语音/文件 | ❌ 忽略      | 需实现 |
| 图片下载          | ✅ 下载到本地         | ❌ 无        | 需实现 |
| 语音转换 SILK→WAV | ✅                    | ❌ 无        | 可选   |
| Intent 权限级别   | ✅ 多级别降级         | ❌ 无        | 需添加 |
| 重连策略          | ✅ 多种延迟+限流      | ⚠️ 简单重连  | 改进   |
| 消息队列          | ✅ 防止阻塞心跳       | ❌ 无        | 需添加 |
| 会话持久化        | ✅ session-store.ts   | ⚠️ JSON 文件 | 改进   |
| 用户记录          | ✅ known-users.ts     | ❌ 无        | 可选   |

### 4. 缺失的功能模块

- `session-store.ts` - 会话持久化（可复用现有 JSON）
- `known-users.ts` - 用户记录（可选）
- `image-server.ts` - 图片服务（可选，有 imageServerBaseUrl 配置）
- `utils/audio-convert.ts` - 语音转换（可选）

---

## 优先级排序

### 高优先级 (必须实现)

1. **Token singleflight** - 防止并发请求重复获取 token
2. **接收图片处理** - 解析 attachments，下载图片，传递给 AI
3. **消息发送返回值** - 返回 messageId 和 timestamp

### 中优先级 (建议实现)

4. **Intent 权限降级** - 支持多级别权限
5. **增强重连策略** - 多种延迟策略
6. **消息队列** - 防止阻塞心跳
7. **图片发送功能** - 完善 <qqimg> 标签处理

### 低优先级 (可选)

8. **用户记录功能** - known-users.ts
9. **语音转换** - SILK → WAV
10. **图片服务** - 本地图片服务器

---

## 实现计划

### Phase 1: 高优先级

1. [ ] Token singleflight 模式
2. [ ] 接收消息 attachments 解析
3. [ ] 图片下载与传递
4. [ ] 消息发送返回值

### Phase 2: 中优先级

5. [x] Intent 权限级别
6. [x] 重连策略增强
7. [x] 消息队列
8. [x] 图片发送完善

### Phase 3: 低优先级

9. [ ] 用户记录
10. [ ] 语音转换
11. [ ] 图片服务
