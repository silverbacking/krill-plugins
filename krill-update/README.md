# krill-update-plugin

Plugin d'actualització automàtica i configuració remota per gateways de la Krill Network.

## Funcionalitats

- 🔔 **Real-time updates** via Matrix (sala `#krill-updates`)
- ⏰ **Polling periòdic** com a fallback (cada 60 min)
- ✅ **Verificació SHA256** de tots els paquets
- 🔐 **Autenticació HMAC** per descarregar updates
- ⚙️ **Auto-update configurable** (activat per defecte)
- 🆕 **Remote config updates** via `ai.krill.config.update` Matrix messages
- 🛡️ **Automatic rollback** si el gateway no arrenca després d'un canvi de config

## Com Funciona

```
┌─────────────────────┐         ┌─────────────────────┐
│   Krill Cloud API   │         │  #krill-updates     │
│  (check-updates)    │         │  (Matrix room)      │
└──────────┬──────────┘         └──────────┬──────────┘
           │                               │
           │ polling (60min)               │ real-time
           │                               │
           └───────────────┬───────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │   krill-update-plugin  │
              │                        │
              │  1. Detecta update     │
              │  2. Descarrega .tgz    │
              │  3. Verifica checksum  │
              │  4. npm install -g     │
              │  5. Notifica restart   │
              └────────────────────────┘
```

## Instal·lació

```bash
clawdbot plugins install -l ./krill-update-plugin
```

## Configuració

```yaml
plugins:
  entries:
    krill-update:
      enabled: true
      config:
        apiUrl: "https://api.krillbot.app"           # Krill Cloud API
        updatesRoom: "!XEo07d0FSUQ7pUhNuteBMl4iRXsZy_PjKwBf7SdBAtk"  # Room ID
        autoUpdate: true                              # Instal·lar automàticament
        checkIntervalMinutes: 60                      # Polling interval
        matrixHomeserver: "https://matrix.krillbot.app"
```

## CLI Commands

```bash
# Comprovar updates disponibles
clawdbot krill-update check

# Llistar plugins instal·lats
clawdbot krill-update list

# Estat del plugin
clawdbot krill-update status

# Forçar sync Matrix
clawdbot krill-update sync
```

## Flux d'Actualització

### Via Matrix (real-time)

Quan es publica un update a `#krill-updates`:

```json
{
  "type": "m.room.message",
  "content": {
    "msgtype": "m.notice",
    "body": "New update: krill-enrollment v0.2.0",
    "ai.krill.plugin.update": {
      "plugin": "krill-enrollment",
      "version": "0.2.0",
      "changelog": "Added retry logic",
      "checksum": "sha256:abc123...",
      "download_url": "https://api.krillbot.app/v1/plugins/download/...",
      "required": false
    }
  }
}
```

### Via API (polling)

```bash
POST /v1/plugins/check-updates
{
  "installed": {
    "krill-enrollment": "0.1.0",
    "krill-update": "1.0.0"
  }
}

# Response
{
  "has_updates": true,
  "updates": [
    {
      "plugin": "krill-enrollment",
      "current": "0.1.0",
      "latest": "0.2.0",
      "download_url": "...",
      "checksum": "sha256:...",
      "required": false
    }
  ]
}
```

## Seguretat

- **Checksums:** Tots els paquets es verifiquen amb SHA256
- **Auth:** Les descàrregues requereixen HMAC-SHA256 signat amb `gatewaySecret`
- **Transport:** Tot via HTTPS

### Header d'Autenticació

```
X-Krill-Auth: <gatewayId>:<timestamp>:<signature>
```

On signature = HMAC-SHA256(`gatewayId:timestamp:plugin:version`, gatewaySecret).substring(0, 32)

## Dependències

Requereix `krill-enrollment-plugin` per:
- `gatewayId` i `gatewaySecret` (autenticació)
- `matrixAccessToken` (accés a la sala d'updates)

## Notes

- Després d'instal·lar un update, cal reiniciar el gateway
- Els updates marcats com `required: true` s'instal·len sempre (fins i tot amb `autoUpdate: false`)
- El plugin fa join automàtic a la sala `#krill-updates`

## Remote Config Updates (NEW in 1.2.0)

Permet modificar la configuració del gateway remotament via Matrix amb rollback automàtic.

### Missatge `ai.krill.config.update`

```json
{
  "type": "ai.krill.config.update",
  "content": {
    "config_patch": {
      "model": "anthropic/claude-sonnet-4",
      "plugins": {
        "entries": {
          "krill-agent-init": {
            "config": {
              "autoRegister": true
            }
          }
        }
      }
    },
    "restart": true,
    "request_id": "optional-correlation-id"
  }
}
```

### Flux de Seguretat

```
1. Backup config → ~/.clawdbot/clawdbot.yaml.bak
2. Apply config_patch (deep merge)
3. Restart gateway
4. Wait 30s for health check
5. IF unhealthy → Restore backup → Restart → Report failure
6. IF healthy → Report success
```

### Exemples d'ús comuns

#### Canviar el model LLM

```json
{
  "type": "ai.krill.config.update",
  "content": {
    "config_patch": {
      "model": "anthropic/claude-sonnet-4"
    },
    "restart": true
  }
}
```

#### Canviar l'API key d'un proveïdor

```json
{
  "type": "ai.krill.config.update",
  "content": {
    "config_patch": {
      "providers": {
        "anthropic": {
          "apiKey": "sk-ant-api03-xxxxx"
        }
      }
    },
    "restart": true
  }
}
```

#### Canviar a OpenAI amb nova key

```json
{
  "type": "ai.krill.config.update",
  "content": {
    "config_patch": {
      "model": "openai/gpt-4o",
      "providers": {
        "openai": {
          "apiKey": "sk-xxxxx"
        }
      }
    },
    "restart": true
  }
}
```

#### Activar/desactivar un plugin

```json
{
  "type": "ai.krill.config.update",
  "content": {
    "config_patch": {
      "plugins": {
        "entries": {
          "krill-agent-init": {
            "enabled": false
          }
        }
      }
    },
    "restart": true
  }
}
```

#### Modificar configuració d'un plugin

```json
{
  "type": "ai.krill.config.update",
  "content": {
    "config_patch": {
      "plugins": {
        "entries": {
          "krill-agent-init": {
            "config": {
              "autoRegister": true,
              "gatewayId": "my-new-gateway-id"
            }
          }
        }
      }
    },
    "restart": true
  }
}
```

#### Canviar configuració del canal Matrix

```json
{
  "type": "ai.krill.config.update",
  "content": {
    "config_patch": {
      "channels": {
        "matrix": {
          "homeserver": "https://matrix.example.com",
          "userId": "@bot:example.com"
        }
      }
    },
    "restart": true
  }
}
```

#### Aplicar canvis sense restart (només guardar)

```json
{
  "type": "ai.krill.config.update",
  "content": {
    "config_patch": {
      "model": "anthropic/claude-opus-4"
    },
    "restart": false
  }
}
```

> ⚠️ **Nota:** Amb `restart: false`, els canvis es guarden però no s'apliquen fins al proper restart manual.

### Resposta `ai.krill.config.update.result`

```json
{
  "type": "ai.krill.config.update.result",
  "content": {
    "request_id": "...",
    "success": true,
    "message": "Config updated successfully",
    "timestamp": 1707012345
  }
}
```

### Configuració

```yaml
plugins:
  entries:
    krill-update:
      config:
        configPath: "~/.clawdbot/clawdbot.yaml"       # Path al config
        restartCommand: "systemctl restart clawdbot-gateway"
        healthCheckTimeoutSeconds: 30
        allowedConfigSenders:                         # Qui pot enviar updates
          - "@admin:matrix.krillbot.app"
          - "@carles:matrix.silverbacking.ai"
```

## Changelog

### 1.2.0 (2026-02-04)
- NEW: Remote config updates via `ai.krill.config.update` Matrix messages
- NEW: Automatic rollback if gateway fails to start after config change
- NEW: Configurable health check timeout
- NEW: Allowed senders whitelist for security

### 1.1.0 (2026-02-03)
- Improved API polling

### 1.0.0 (2026-02-02)
- Initial release
- Real-time Matrix sync
- Periodic API polling
- SHA256 checksum verification
- CLI commands
