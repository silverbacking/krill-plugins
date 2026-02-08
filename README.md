# Krill Plugins

Official OpenClaw plugins for the Krill Network.

## Active Plugins

### krill-agent-init

**Purpose:** One-time agent enrollment on startup.

- Creates Matrix user (if needed)
- Registers with Krill API
- Provisions gateway credentials

**When to use:** Every Krill Network gateway needs this plugin.

### krill-matrix-protocol

**Purpose:** Universal handler for all `ai.krill.*` protocol messages.

Intercepts Matrix messages **before** they reach the LLM and handles:

| Message Type | Function |
|--------------|----------|
| `ai.krill.pair.request/response/complete/revoke` | Device-agent pairing |
| `ai.krill.verify.request/response` | Agent verification |
| `ai.krill.health.ping/pong/ack` | Health monitoring |
| `ai.krill.config.update/result` | Remote config updates |
| `ai.krill.senses.update/updated` | Permission management |

**Health States:**

| State | Color | Meaning |
|-------|-------|---------|
| `online` | 🟢 | Gateway + LLM working |
| `unresponsive` | 🟡 | Gateway OK, LLM timeout |
| `offline` | 🔴 | No response |

### krill-matrix-plugin

**Purpose:** Matrix SDK integration and helpers for Krill.

### krill-update

**Purpose:** Auto-update and remote config management.

- Real-time updates via Matrix
- Config patches with automatic rollback
- Health checks after restart

## Installation

```bash
# In your OpenClaw gateway
openclaw plugin install krill-agent-init
openclaw plugin install krill-matrix-protocol
```

## Configuration

Add to your `config.yaml`:

```yaml
plugins:
  entries:
    krill-agent-init:
      config:
        krillApiUrl: "https://api.krillbot.network"
        agent:
          displayName: "My Agent"
          description: "A helpful AI assistant"
          capabilities: ["chat", "senses"]
          
    krill-matrix-protocol:
      config:
        storagePath: "/data/krill-pairings.json"
        agent:
          mxid: "@myagent:matrix.krillbot.network"
          displayName: "My Agent"
          capabilities: ["chat", "senses"]
        config:
          allowedConfigSenders:
            - "@krill-api:matrix.krillbot.network"
```

## Removed Plugins (2026-02-08)

The following plugins have been removed and their functionality consolidated:

- ~~krill-enrollment-plugin~~ → Merged into `krill-agent-init`
- ~~krill-pairing-plugin~~ → Merged into `krill-matrix-protocol`
- ~~krill-safe-plugin~~ → Was placeholder, never implemented

## Protocol Reference

See [docs/PROTOCOL.md](docs/PROTOCOL.md) for the full Krill Protocol specification.

## License

MIT
