# Krill Plugins

Sistema de comunicació segura entre usuaris (Krill App) i agents IA sobre el protocol Matrix.

## 🎯 Visió

Krill permet que usuaris es connectin amb agents IA de manera segura, autenticada i amb control de permisos (senses). Tot el sistema funciona sobre **Matrix protocol** - l'únic canal exposat públicament.

## 📐 Arquitectura

```
┌─────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Krill App  │◄───────►│  KrillMatrix    │◄───────►│  OpenClaw       │
│  (mòbil)    │  HTTPS  │  (Synapse)      │  local  │  Gateway        │
│             │  Matrix │  Cloudflare     │         │  (Clawdbot)     │
└─────────────┘         └─────────────────┘         └─────────────────┘
```

**Principis:**
- Tot passa per Matrix (no endpoints HTTP externs)
- Agents marcats amb atributs verificables
- Pairing per dispositiu amb token compartit
- Senses (permisos) controlats per l'usuari

## 📚 Documentació

| Document | Descripció |
|----------|------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Visió general del sistema |
| [ARCHITECTURE-MATRIX.md](docs/ARCHITECTURE-MATRIX.md) | Arquitectura Matrix-only (definitiva) |
| [KRILL-APP-FLOW.md](docs/KRILL-APP-FLOW.md) | Flux des de la perspectiva de l'app |
| [GATEWAY-INTEGRATION.md](docs/GATEWAY-INTEGRATION.md) | Integració amb el gateway |

## 🔌 Plugins

### krill-enrollment-plugin
**Registre d'agents al servidor Matrix**

- Publica state events `ai.krill.agent` a la room de registre
- Inclou hash de verificació per autenticar agents
- Permet descobriment d'agents per Krill App

```yaml
plugins:
  entries:
    krill-enrollment:
      enabled: true
      config:
        gatewayId: "my-gateway-001"
        gatewaySecret: "super-secret-key"
        agents:
          - mxid: "@jarvis:matrix.example.com"
            displayName: "Jarvis"
            capabilities: ["chat", "senses"]
```

### krill-pairing-plugin
**Gestió de pairings usuari-agent**

- Processa peticions de pairing via Matrix
- Genera tokens segurs (HMAC-SHA256)
- Emmagatzema pairings amb hash del token
- Gestiona senses (permisos)

### krill-safe-plugin
**Validació de missatges**

- Intercepta missatges Matrix entrants
- Valida tokens d'autenticació
- Bloqueja missatges no autenticats
- Respon amb `ai.krill.auth.required` si cal

## 🔐 Flux de Seguretat

### 1. Enrollment (Agent Discovery)
```
Gateway                           Matrix Server
   │                                    │
   │  PUT state event                   │
   │  ai.krill.agent                    │
   │  + verification_hash               │
   │ ─────────────────────────────────► │
   │                                    │
                     Room: #krill-agents:server
```

### 2. Pairing (Autenticació)
```
Krill App                         Gateway (@agent)
   │                                    │
   │  ai.krill.pair.request             │
   │  { device_id, device_name }        │
   │ ─────────────────────────────────► │
   │                                    │
   │  ai.krill.pair.response            │
   │  { pairing_token: "krill_tk_..." } │
   │ ◄───────────────────────────────── │
   │                                    │
```

### 3. Comunicació Autenticada
```json
{
  "type": "m.room.message",
  "content": {
    "msgtype": "m.text",
    "body": "Hola Jarvis!",
    "ai.krill.auth": {
      "pairing_token": "krill_tk_v1_..."
    }
  }
}
```

## 📋 Event Types

| Event | Direcció | Descripció |
|-------|----------|------------|
| `ai.krill.agent` | State | Agent registrat (enrollment) |
| `ai.krill.pair.request` | App → Agent | Sol·licitud de pairing |
| `ai.krill.pair.response` | Agent → App | Resposta amb token |
| `ai.krill.pair.revoke` | App → Agent | Revoca pairing |
| `ai.krill.auth.required` | Agent → App | Token invàlid |
| `ai.krill.senses.update` | App → Agent | Actualitza permisos |

## 🚀 Instal·lació

```bash
# Clonar el repo
git clone https://github.com/silverbacking/krill-plugins.git

# Instal·lar plugins a Clawdbot
clawdbot plugins install -l ./plugins/krill-enrollment-plugin
clawdbot plugins install -l ./plugins/krill-pairing-plugin
clawdbot plugins install -l ./plugins/krill-safe-plugin
```

## 🏗️ Estructura del Repo

```
krill-plugins/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── FULL-PROTOCOL.md
│   ├── DEPLOYMENT-TIERS.md
│   └── SECURITY-ANALYSIS.md
├── krill-enrollment-plugin/
│   ├── src/index.ts
│   ├── clawdbot.plugin.json
│   └── README.md
├── krill-pairing-plugin/
│   ├── src/index.ts
│   ├── PROTOCOL.md
│   └── README.md
├── krill-safe-plugin/
│   └── README.md
└── README.md
```

## 📊 Estat de Desenvolupament

| Component | Estat | Notes |
|-----------|-------|-------|
| Enrollment (state events) | ✅ Complet | Jarvis enrollat a matrix.silverbacking.ai |
| Pairing (HTTP) | ✅ Complet | Funcional per testing |
| Pairing (Matrix) | 🔨 En progrés | Migrant a events Matrix |
| Safe (validació) | 📋 Dissenyat | Pendent implementació |
| Krill App | 📋 Planificat | Pendent desenvolupament |

## 🔗 Recursos

- **Repo:** https://github.com/silverbacking/krill-plugins
- **Room de registre:** #krill-agents:matrix.silverbacking.ai
- **Gateway:** Clawdbot (OpenClaw)

## 📄 Llicència

MIT
