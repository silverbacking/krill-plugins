# Plugin Deployment Guide

## Quick Reference

```bash
# Deploy ALL official plugins to central-node
./scripts/deploy-to-central.sh

# Deploy a single plugin
./scripts/deploy-to-central.sh krill-matrix-protocol

# Deploy multiple specific plugins
./scripts/deploy-to-central.sh krill-update krill-email
```

## What the Script Does

For each plugin:

1. Reads version from `package.json`
2. Compiles TypeScript (`tsc`) if `tsconfig.json` exists
3. Packages with `npm pack` → `{plugin}-{version}.tgz`
4. Calculates SHA256 checksum
5. Generates `latest.json` (version manifest)
6. **Removes old `.tgz` files** from the server
7. Uploads `.tgz` + `latest.json` + `.sha256` to `/opt/krill/plugins/{plugin}/`
8. Verifies the API returns the correct version

On a full deploy, it also cleans `/opt/krill/plugin-packages/` (legacy directory).

## Central Node

| Field | Value |
|-------|-------|
| Host | `100.98.141.108` (Tailscale) / `65.108.93.112` (public) |
| SSH | `root@100.98.141.108` with key `~/.secrets/hetzner-krill-node.key` |
| Plugins dir | `/opt/krill/plugins/` |
| API | `http://localhost:3000/v1/plugins` |

## Directory Structure on Server

```
/opt/krill/plugins/
├── krill-agent-init/
│   ├── krill-agent-init-1.0.0.tgz      ← downloadable package
│   ├── krill-agent-init-1.0.0.tgz.sha256
│   ├── latest.json                      ← version manifest
│   ├── package.json                     ← source (fallback for API)
│   └── ...source files...
├── krill-email/
│   └── ...
├── krill-matrix-protocol/
│   └── ...
└── krill-update/
    └── ...
```

## `latest.json` Format

```json
{
  "plugin": "krill-update",
  "version": "1.6.0",
  "filename": "krill-update-1.6.0.tgz",
  "checksum": "sha256:e602ef76d1d9f6bf929a745fa30306522965e95b706880549adf33010662ff70",
  "packaged_at": "2026-03-09T00:15:00Z"
}
```

The API scans `/opt/krill/plugins/*/latest.json` to build the plugin registry. If `latest.json` is missing, it falls back to reading `package.json` — but then there's no `.tgz` to serve for download.

## Official Plugins

| Plugin | Purpose |
|--------|---------|
| `krill-agent-init` | One-time agent enrollment on startup |
| `krill-email` | Email integration for agents |
| `krill-matrix-protocol` | Universal handler for `ai.krill.*` protocol messages |
| `krill-update` | Auto-update and remote config management |

## How Gateways Receive Updates

```
Gateway (krill-update plugin)
    │
    ├── Polling: POST /v1/plugins/check-updates (every 60 min)
    │   → Sends installed versions
    │   → Receives list of available updates with download URLs
    │
    └── Real-time: Listens to #krill-updates Matrix room
        → Receives ai.krill.plugin.update messages
        → Downloads and installs automatically (if autoUpdate=true)
```

## Adding a New Plugin

1. Create the plugin directory in this repo: `krill-{name}/`
2. Include `package.json`, `tsconfig.json`, source files
3. Add the plugin name to `OFFICIAL_PLUGINS` in `scripts/deploy-to-central.sh`
4. Run `./scripts/deploy-to-central.sh krill-{name}`

## Troubleshooting

**API shows wrong version:**
The API caches the plugin scan at startup. After uploading new files, the API re-scans on the next `check-updates` request. If it still shows stale data, restart the API:
```bash
ssh root@100.98.141.108 "cd /opt/krill && docker compose restart krill-api"
# or if running directly:
ssh root@100.98.141.108 "systemctl restart krill-api"
```

**Download returns 404:**
Check that both `latest.json` AND the `.tgz` file exist in the plugin directory. The filename in `latest.json` must match the actual `.tgz` filename exactly.

**Checksum mismatch on gateway:**
Re-run the deploy script — it regenerates the checksum from the freshly packed `.tgz`.
