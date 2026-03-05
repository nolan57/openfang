# QQ Bot Reconnection Analysis

This document analyzes the reconnection logic in `packages/plugin-qqbot` and identifies issues based on the QQ Bot platform documentation.

---

## Current Reconnection Implementation

### Flow Overview

```
Connection Lost → scheduleReconnect() → start() → getAccessToken() → getGatewayUrl() → connect() → identify()
```

**Code Location**: `packages/plugin-qqbot/src/gateway.ts`

### Key Methods

1. **`scheduleReconnect()`** (lines 684-711): Handles reconnection scheduling with exponential backoff
2. **`start()`** (lines 127-160): Initiates full connection process
3. **`connect()`** (lines 162-190): Creates WebSocket connection
4. **`sendIdentify()`** (lines 220-239): Sends IDENTIFY opcode to authenticate

---

## Issues Identified

### 1. No RESUME Support (Critical)

**Problem**: The QQ Bot platform uses a session-based reconnection model similar to Discord. When a connection is lost, the server may return **error code 4009** ("连接过期，请重连并执行 resume 进行重新连接").

According to the [QQ Bot WebSocket Documentation](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/error-trace/websocket.html):

| Error Code | Description        | Action                  |
| ---------- | ------------------ | ----------------------- |
| 4007       | Seq error          | Can retry with IDENTIFY |
| 4008       | Payload too fast   | Can retry               |
| 4009       | Connection expired | **Must use RESUME**     |
| 4015       | Robot banned       | Do not retry            |

**Current Behavior**: The code always performs a full IDENTIFY (op 2), even when RESUME (op 6) should be used.

**Impact**:

- After a temporary disconnect, the server expects a RESUME with the previous session ID
- Using IDENTIFY instead may cause the server to reject the connection
- This is likely the root cause of "platform rejecting connections"

---

### 2. No Session Persistence (Critical)

**Problem**: The code receives and stores `sessionId` on successful connection (line 273):

```typescript
case "READY":
  this.sessionId = (data as { session_id: string }).session_id
```

However:

- The sessionId is never persisted to disk
- After restart, the bot has no session to resume
- Each reconnection starts fresh, increasing load on the QQ server

**Evidence**: No session save/load code exists (searched for `sessionId` persistence - none found)

---

### 3. Auth Error Handling Bug

**Problem**: There's a logical flaw in the auth error handling:

**In `handleMessage()`** (line 196-200):

```typescript
case 9:
  this.authError = true
  this.onStatus.error("Invalid session (authentication failed), not retrying")
  break
```

**In `scheduleReconnect()`** (line 690-693):

```typescript
if (this.authError) {
  this.onStatus.message("Clearing auth error, will retry with fresh token...")
  this.authError = false // BUG: Clears the flag immediately!
}
```

**Impact**:

- When op 9 (Invalid Session) is received, `authError` is set to true
- But `scheduleReconnect` immediately clears it before retrying
- This creates a retry loop that may not properly handle the error

---

### 4. No Error Code Differentiation

**Problem**: The `onclose` handler (line 178-183) treats all disconnections the same:

```typescript
this.ws.onclose = (event: any) => {
  this.onStatus.disconnected()
  this.onStatus.message(`Disconnected: ${event.code}`)
  this.stopHeartbeat()
  this.scheduleReconnect() // Always schedules reconnect, regardless of error code
}
```

**Missing Logic**:

- Error code 4009 should use RESUME
- Error code 4007/4008 can retry with backoff
- Error code 4015 (banned) should NOT retry
- No network error vs clean close differentiation

---

### 5. Potential Rate Limiting

**Problem**: Each reconnection does a full IDENTIFY:

1. Get new access token (API call)
2. Get gateway URL (API call)
3. Create new WebSocket
4. Send IDENTIFY

**Risk**: According to the docs, error code 4008 indicates "发送 payload 过快，请重新连接，并遵守连接后返回的频控信息" (sending payload too fast, please reconnect and respect rate limits).

Frequent reconnections without proper session resumption may trigger rate limiting from the QQ platform.

---

## Analysis: Why Reconnection Fails

### Most Likely Scenario

Based on the issues above, here's what likely happens:

```
1. Bot connects successfully (IDENTIFY)
2. Temporary network issue or server-side disconnect
3. Bot's onclose fires
4. scheduleReconnect() is called
5. Bot does FULL RECONNECT (not RESUME):
   - Gets new token
   - Gets new gateway
   - Creates new WebSocket
   - Sends IDENTIFY
6. Server expects RESUME (error code 4009)
7. Server rejects the IDENTIFY attempt
8. Connection fails repeatedly
```

### Why the Platform May Reject Connections

1. **Session Mismatch**: Server has a session for the old connection; IDENTIFY creates conflicts
2. **Rate Limiting**: Too many IDENTIFY requests trigger 4008
3. **Invalid Session**: Server already invalidated the session; needs RESUME with valid session_id

---

## Configuration Available

The plugin uses environment variables from `packages/plugin-qqbot/src/config.ts`:

| Variable            | Description                                 | Default     |
| ------------------- | ------------------------------------------- | ----------- |
| QQBOT_ENABLED       | Enable the plugin                           | false       |
| QQBOT_APP_ID        | Bot App ID                                  | -           |
| QQBOT_CLIENT_SECRET | Bot secret                                  | -           |
| QQBOT_DEFAULT_AGENT | Default agent                               | "build"     |
| QQBOT_DM_POLICY     | DM policy (pairing/allowlist/open/disabled) | "pairing"   |
| QQBOT_GROUP_POLICY  | Group policy                                | "allowlist" |

**Note**: There are no configuration options for:

- Session persistence
- RESUME vs IDENTIFY behavior
- Reconnection strategy

---

## Recommendations

To fix the reconnection issues, the code needs:

1. **Implement RESUME support**: Add `sendResume()` method using op 6
2. **Persist session**: Save sessionId to sessions.json, load on startup
3. **Handle error codes properly**: Differentiate between 4007, 4008, 4009, 4015
4. **Fix auth error logic**: Don't immediately clear `authError` flag
5. **Add retry delay**: Respect rate limit guidance from server

---

## Conclusion

**The reconnection logic does have issues**, specifically:

1. **Primary Issue**: No RESUME support - always uses full IDENTIFY
2. **Secondary Issue**: Session not persisted, making RESUME impossible anyway
3. **Tertiary Issue**: Error code handling doesn't follow QQ Bot platform guidelines

This combination likely causes the QQ platform to reject reconnection attempts, as the bot keeps sending IDENTIFY when the server expects RESUME, or gets rate-limited from excessive reconnections.

**The fix would require**: Implementing proper session management and RESUME/IDENTIFY decision logic based on the websocket close codes from the QQ platform.
