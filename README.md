# Krill Plugins

Sistema de comunicació segura entre usuaris (Krill App) i agents IA sobre el protocol Matrix.

## 🎯 Visió

Krill permet que usuaris es connectin amb agents IA de manera segura, autenticada i amb control de permisos (senses). Tot el sistema funciona sobre **Matrix protocol** - l'únic canal exposat públicament.

## 📐 Arquitectura

```
┌─────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Krill App  │◄───────►│  Krill Central  │◄───────►│  Krill Gateway  │
│  (mòbil)    │  Matrix │  (Conduit)      │  Matrix │  (Clawdbot +    │
│             │         │  krillbot.app   │         │   plugins)      │
└─────────────┘         └─────────────────┘         └─────────────────┘
```

**Components:**
- **Krill App** - App mòbil Flutter (iOS/Android)
- **Krill Central** - matrix.krillbot.app (Conduit) + api.krillbot.app
- **Krill Gateway** - Clawdbot amb krill-plugins instal·lats

**Principis:**
- Tot passa per Matrix (no endpoints HTTP externs)
- Agents marcats amb atributs verificables
- Pairing per dispositiu amb token compartit
- Senses (permisos) controlats per l'usuari

## 📚 Documentació

| Document | Descripció |
|----------|------------|
| [PROTOCOL.md](docs/PROTOCOL.md) | Protocol Krill complet (referència) |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Visió general del sistema |
| [ARCHITECTURE-MATRIX.md](docs/ARCHITECTURE-MATRIX.md) | Arquitectura Matrix-only |
| [KRILL-APP-FLOW.md](docs/KRILL-APP-FLOW.md) | Flux des de la perspectiva de l'app |
| [GATEWAY-INTEGRATION.md](docs/GATEWAY-INTEGRATION.md) | Integració amb el gateway |
| [SECURITY-ANALYSIS.md](docs/SECURITY-ANALYSIS.md) | Anàlisi de seguretat |

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
        registryRoomId: "!abc123:matrix.krillbot.app"
        agents:
          - mxid: "@jarvis:matrix.krillbot.app"
            displayName: "Jarvis"
            capabilities: ["chat", "senses"]
```

### krill-pairing-plugin
**Gestió de pairings usuari-agent**

- Processa peticions de pairing via Matrix
- Genera tokens segurs (HMAC-SHA256)
- Emmagatzema pairings amb hash del token
- Gestiona senses (permisos)

### krill-matrix-plugin
**Fork de @clawdbot/matrix amb suport Krill natiu**

- Intercepta events Krill abans de l'agent IA
- Processament determinístic (no depèn de l'LLM)
- Gestiona pairing, senses, auth de forma nativa

### krill-update-plugin
**Actualitzacions automàtiques**

- Real-time updates via Matrix (#krill-updates)
- Polling periòdic com a fallback
- Verificació SHA256 de paquets
- Auto-update configurable

### krill-safe-plugin
**Validació de missatges** *(planificat)*

- Intercepta missatges Matrix entrants
- Valida tokens d'autenticació
- Bloqueja missatges no autenticats

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
                     Room: #krill-agents:matrix.krillbot.app
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
| `ai.krill.pair.complete` | App → Agent | Confirmació (invisible) |
| `ai.krill.pair.revoke` | App → Agent | Revoca pairing |
| `ai.krill.auth.required` | Agent → App | Token invàlid |
| `ai.krill.senses.update` | App → Agent | Actualitza permisos |
| `ai.krill.plugin.update` | Cloud → Gateway | Notificació d'update |

## 🚀 Instal·lació

```bash
# Clonar el repo
git clone https://github.com/silverbacking/krill-plugins.git
cd krill-plugins

# Instal·lar plugins a Clawdbot
clawdbot plugins install -l ./krill-enrollment-plugin
clawdbot plugins install -l ./krill-pairing-plugin
clawdbot plugins install -l ./krill-matrix-plugin
clawdbot plugins install -l ./krill-update-plugin
```

## 🏗️ Estructura del Repo

```
krill-plugins/
├── docs/
│   ├── PROTOCOL.md              # Protocol complet
│   ├── ARCHITECTURE.md          # Arquitectura general
│   ├── ARCHITECTURE-MATRIX.md   # Arquitectura Matrix-only
│   ├── DEPLOYMENT-TIERS.md      # Tiers de desplegament
│   ├── SECURITY-ANALYSIS.md     # Anàlisi de seguretat
│   └── ...
├── krill-enrollment-plugin/     # Registre d'agents
│   ├── src/index.ts
│   ├── clawdbot.plugin.json
│   └── README.md
├── krill-pairing-plugin/        # Gestió de pairings
│   ├── src/index.ts
│   └── README.md
├── krill-matrix-plugin/         # Fork Matrix amb Krill
│   ├── src/index.ts
│   └── README.md
├── krill-update-plugin/         # Auto-updates
│   ├── src/index.ts
│   └── README.md
├── krill-safe-plugin/           # Validació (planificat)
│   └── README.md
└── README.md
```

## 📊 Estat de Desenvolupament

| Component | Estat | Notes |
|-----------|-------|-------|
| **Krill Central Node** | ✅ Operatiu | matrix.krillbot.app + api.krillbot.app |
| **krill-enrollment-plugin** | ✅ Complet | Jarvis enrollat |
| **krill-pairing-plugin** | ✅ Complet | Events Matrix |
| **krill-matrix-plugin** | ✅ Complet | Fork funcional |
| **krill-update-plugin** | ✅ Complet | Real-time + polling |
| **krill-safe-plugin** | 📋 Planificat | Pendent implementació |
| **Krill App (Flutter)** | 🔨 En progrés | MVP funcional, testing |

## 🌐 Infraestructura

| Servei | URL | Descripció |
|--------|-----|------------|
| Matrix | matrix.krillbot.app | Conduit homeserver |
| API | api.krillbot.app | Krill Cloud API |
| Registry | #krill-agents:matrix.krillbot.app | Room de registre |
| Updates | #krill-updates:matrix.krillbot.app | Notificacions d'updates |

## 🔗 Projectes Relacionats

| Projecte | Ubicació | Descripció |
|----------|----------|------------|
| krill-app | `~/jarvis/projects/krill-app` | App Flutter (iOS/Android) |
| krill (central) | `~/jarvis/krill` | Scripts central node |

## 📄 Llicència

MIT
