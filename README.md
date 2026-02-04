# Krill Plugins

Official Clawdbot plugins for the Krill Network.

## Plugins

### krill-agent-init

**Purpose:** One-time agent enrollment on startup.

- Creates Matrix user (if needed)
- Joins the Krill registry room
- Publishes `ai.krill.agent` state event
- Registers with Krill API

**When to use:** Every Krill Network gateway needs this plugin.

### krill-matrix-protocol

**Purpose:** Universal handler for all `ai.krill.*` protocol messages.

Intercepts Matrix messages **before** they reach the LLM and handles:

| Message Type | Function |
|--------------|----------|
| `ai.krill.pair.request/response` | Device-agent pairing |
| `ai.krill.verify.request/response` | Agent verification |
| `ai.krill.health.ping/ack/pong` | Health monitoring |

**Health States:**

| State | Color | Meaning |
|-------|-------|---------|
| `online` | 🟢 | Gateway + LLM working |
| `unresponsive` | 🟡 | Gateway OK, LLM timeout |
| `offline` | 🔴 | No response |

**Optimization:** Skips LLM test if agent was active in last 5 minutes (saves tokens).

## Plugin Structure (Central Node)

When deploying plugins to the central node for distribution, they **must** follow this exact structure:

```
/opt/krill/plugins/
├── krill-agent-init/
│   ├── clawdbot.plugin.json    # Manifest (MUST be at root!)
│   ├── index.js                 # Compiled JS (MUST be at root!)
│   ├── package.json
│   └── tsconfig.json           # Optional, for reference
│
├── krill-matrix-protocol/
│   ├── clawdbot.plugin.json
│   ├── index.js
│   ├── package.json
│   └── README.md
│
└── krill-update/
    ├── clawdbot.plugin.json
    ├── index.js
    ├── package.json
    └── README.md
```

### ⚠️ Critical Requirements

| Requirement | ✅ Correct | ❌ Wrong |
|-------------|-----------|----------|
| Manifest location | `plugin/clawdbot.plugin.json` | `plugin/src/clawdbot.plugin.json` |
| Entry point | `plugin/index.js` | `plugin/dist/index.js` |
| Manifest "main" | `"main": "index.js"` | `"main": "dist/index.js"` |
| Source files | Remove after compile | Keep `src/` folder |

### Why?

Clawdbot derives the plugin ID from the entry point path. If `index.js` is inside `/dist/`, it will warn:
```
WARN: plugin id mismatch (manifest uses "krill-agent-init", entry hints "dist")
```

### Build & Deploy Workflow

```bash
# 1. Develop locally with TypeScript
npm run build                    # Compiles src/index.ts → dist/index.js

# 2. Prepare for central node
mv dist/index.js ./index.js      # Move to root
rm -rf dist/ src/                # Remove source folders

# 3. Update manifest
sed -i 's|dist/index.js|index.js|g' clawdbot.plugin.json

# 4. Deploy to central node
scp -r ./krill-my-plugin root@central-node:/opt/krill/plugins/
```

## Installation

```bash
# In your Clawdbot gateway
clawdbot plugin install krill-agent-init
clawdbot plugin install krill-matrix-protocol
```

## Configuration

Add to your `config.yaml`:

```yaml
plugins:
  entries:
    krill-agent-init:
      config:
        gatewayId: "my-gateway-001"
        gatewaySecret: "${KRILL_SECRET}"
        registryRoomId: "!roomid:matrix.krillbot.network"
        krillApiUrl: "https://api.krillbot.network"
        agent:
          mxid: "@myagent:matrix.krillbot.network"
          displayName: "My Agent"
          description: "A helpful AI assistant"
          capabilities: ["chat", "senses"]
          
    krill-matrix-protocol:
      config:
        gatewayId: "my-gateway-001"
        gatewaySecret: "${KRILL_SECRET}"
        storagePath: "/data/krill-pairings.json"
        agent:
          mxid: "@myagent:matrix.krillbot.network"
          displayName: "My Agent"
          capabilities: ["chat", "senses"]
```

## Deprecated Plugins

The following plugins are deprecated and replaced by the two above:

- ~~krill-enrollment-plugin~~ → Use `krill-agent-init`
- ~~krill-pairing-plugin~~ → Use `krill-matrix-protocol`
- ~~krill-safe-plugin~~ → Merged into `krill-matrix-protocol`
- ~~krill-update-plugin~~ → Will be separate

## Protocol Reference

See [PROTOCOL.md](docs/PROTOCOL.md) for the full Krill Protocol specification.

## License

MIT
