# plugin-qqbot vs qqbot Comparison Analysis

## Project Structure Comparison

| File             | qqbot (Reference) | plugin-qqbot (Current) |
| ---------------- | ----------------- | ---------------------- |
| api.ts           | ✅ Full implementation | ✅ Basic implementation |
| gateway.ts       | ✅ Full functionality | ⚠️ Simplified version |
| outbound.ts      | ✅ Complete message queue | ⚠️ Simplified version |
| types.ts         | ✅ Complete types | ✅ Basic types |
| session-store.ts | ✅ Persistent storage | ❌ Missing |
| known-users.ts   | ✅ User records | ❌ Missing |
| runtime.ts       | ✅ Runtime state | ❌ Missing |
| image-server.ts  | ✅ Image service | ❌ Missing |
| utils/*          | ✅ Utility functions | ❌ Missing |

---

## Feature Comparison Details

### 1. API Layer

| Feature                | qqbot                        | plugin-qqbot       | Status        |
| ---------------------- | ---------------------------- | ------------------ | ------------- |
| Token singleflight     | ✅ Prevents concurrent duplicate fetches | ❌ Simple cache | Needs improvement |
| Markdown support       | ✅ initApiConfig configuration | ⚠️ Configured but not implemented | Needs completion |
| Unified apiRequest     | ✅ Unified error handling | ❌ Direct fetch | Needs improvement |
| msg_seq generation     | ✅ | ✅ | Completed |
| Rich media upload      | ✅ uploadC2CMedia | ❌ Missing | Needs addition |
| Image message sending  | ✅ sendC2CMediaMessage | ❌ Missing | Needs addition |
| Voice message sending  | ✅ sendGroupMediaMessage | ❌ Missing | Needs addition |

### 2. Outbound Layer

| Feature                    | qqbot       | plugin-qqbot       | Status        |
| -------------------------- | ----------- | ------------------ | ------------- |
| Image tag handling         | ✅ Complete | ⚠️ Simple text replacement | Needs improvement |
| Local image to Base64      | ✅ | ❌ Missing | Needs addition |
| Remote image URL           | ✅ | ⚠️ Text prompt only | Needs improvement |
| Message send queue         | ✅ Sequential sending | ❌ Missing | Needs addition |
| Return messageId           | ✅ | ❌ void | Needs improvement |
| Error recovery             | ✅ Detailed | ❌ Simple throw | Needs improvement |

### 3. Gateway Layer (Message Reception)

| Feature                    | qqbot                 | plugin-qqbot | Status        |
| -------------------------- | --------------------- | ------------ | ------------- |
| attachments parsing        | ✅ Handle images/audio/files | ❌ Ignored | Needs implementation |
| Image download             | ✅ Download to local | ❌ Missing | Needs implementation |
| Voice conversion SILK→WAV  | ✅ | ❌ Missing | Optional |
| Intent permission levels   | ✅ Multi-level degradation | ❌ Missing | Needs addition |
| Reconnection policy        | ✅ Multiple delays + rate limiting | ⚠️ Simple reconnect | Needs improvement |
| Message queue              | ✅ Prevent heartbeat blocking | ❌ Missing | Needs addition |
| Session persistence        | ✅ session-store.ts | ⚠️ JSON file | Needs improvement |
| User records               | ✅ known-users.ts | ❌ Missing | Optional |

### 4. Missing Functionality Modules

- `session-store.ts` - Session persistence (can reuse existing JSON)
- `known-users.ts` - User records (optional)
- `image-server.ts` - Image service (optional, has imageServerBaseUrl configuration)
- `utils/audio-convert.ts` - Voice conversion (optional)

---

## Priority Ranking

### High Priority (Must Implement)

1. **Token singleflight** - Prevent concurrent duplicate token requests
2. **Receive image handling** - Parse attachments, download images, pass to AI
3. **Message send return value** - Return messageId and timestamp

### Medium Priority (Recommended)

4. **Intent permission degradation** - Support multi-level permissions
5. **Enhanced reconnection policy** - Multiple delay strategies
6. **Message queue** - Prevent heartbeat blocking
7. **Image sending functionality** - Complete <qqimg> tag handling

### Low Priority (Optional)

8. **User records feature** - known-users.ts
9. **Voice conversion** - SILK → WAV
10. **Image service** - Local image server

---

## Implementation Plan

### Phase 1: High Priority

1. [ ] Token singleflight pattern
2. [ ] Receive message attachments parsing
3. [ ] Image download and passing
4. [ ] Message send return value

### Phase 2: Medium Priority

5. [x] Intent permission levels
6. [x] Enhanced reconnection policy
7. [x] Message queue
8. [x] Image sending completion

### Phase 3: Low Priority

9. [ ] User records
10. [ ] Voice conversion
11. [ ] Image service
