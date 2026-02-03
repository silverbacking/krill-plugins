# krill-matrix-protocol

Universal handler for all `ai.krill.*` protocol messages in Clawdbot gateways.

## Features

- **Pairing** (`ai.krill.pair.*`) - Device-agent pairing
- **Verification** (`ai.krill.verify.*`) - Agent verification
- **Health Check** (`ai.krill.health.*`) - Agent health monitoring with 3 states

## States

| State | Color | Meaning |
|-------|-------|---------|
| `online` | 🟢 | Gateway OK + LLM OK |
| `unresponsive` | 🟡 | Gateway OK + LLM timeout |
| `offline` | 🔴 | No response |

## Configuration

```yaml
plugins:
  entries:
    krill-matrix-protocol:
      config:
        gatewayId: "my-gateway-001"
        gatewaySecret: "secret-key"
        storagePath: "/data/krill-pairings.json"
        agent:
          mxid: "@myagent:matrix.krillbot.network"
          displayName: "My Agent"
          description: "A helpful AI assistant"
          capabilities: ["chat", "senses"]
```

## Protocol Messages

### Pairing

**Request:**
```json
{"type": "ai.krill.pair.request", "content": {"device_id": "...", "device_name": "...", "timestamp": ...}}
```

**Response:**
```json
{"type": "ai.krill.pair.response", "content": {"success": true, "pairing_id": "...", "pairing_token": "...", ...}}
```

### Health Check

**Ping (from monitor):**
```json
{"type": "ai.krill.health.ping", "content": {"request_id": "...", "skip_llm_test": false}}
```

**ACK (immediate):**
```json
{"type": "ai.krill.health.ack", "content": {"request_id": "...", "agent_id": "...", "gateway_id": "..."}}
```

**Pong (with LLM status):**
```json
{"type": "ai.krill.health.pong", "content": {"request_id": "...", "status": "online", "llm_status": "ok", ...}}
```

## Optimization

If the agent was active in the last 5 minutes (sent messages in the room), the LLM test is skipped to save tokens.
