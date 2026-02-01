# Krill Architecture

## Overview

Krill és un sistema de comunicació segura entre usuaris (humans) i agents (IA) sobre el protocol Matrix.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│    ┌─────────────┐              ┌─────────────────┐            │
│    │  Krill App  │◄────────────►│  KrillMatrix    │            │
│    │  (mòbil)    │    Matrix    │  (Synapse)      │            │
│    │             │    HTTPS     │                 │            │
│    └─────────────┘              └────────┬────────┘            │
│                                          │                      │
│                                          │ Matrix (local)       │
│                                          │                      │
│                                          ▼                      │
│                                 ┌─────────────────┐            │
│                                 │  OpenClaw       │            │
│                                 │  Gateway        │            │
│                                 │  (Clawdbot)     │            │
│                                 │                 │            │
│                                 │  ┌───────────┐  │            │
│                                 │  │  Agent    │  │            │
│                                 │  │  (Claude) │  │            │
│                                 │  └───────────┘  │            │
│                                 └─────────────────┘            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### Krill App
Aplicació mòbil (iOS/Android) que l'usuari fa servir per comunicar-se amb agents.

**Responsabilitats:**
- Descobrir agents disponibles
- Iniciar pairing amb agents
- Enviar missatges autenticats
- Gestionar senses (permisos)
- Guardar tokens de forma segura

### KrillMatrix Server
Servidor Matrix (Synapse) accessible públicament via Cloudflare.

**Responsabilitats:**
- Autenticació d'usuaris Matrix
- Routing de missatges
- Emmagatzematge d'state events (enrollment)
- Federació (opcional)

### OpenClaw Gateway
Clawdbot running locally, connectat al servidor Matrix.

**Responsabilitats:**
- Controlar l'agent IA (Claude)
- Processar events Krill (pairing, senses)
- Validar tokens d'autenticació
- Emmagatzemar pairings

### Agent
Compte Matrix controlat pel gateway (@jarvis:server).

**Responsabilitats:**
- Respondre a missatges dels usuaris
- Executar accions (eines, senses)
- Mantenir context de conversa

---

## Flux Principal

### 1. Enrollment
```
Gateway → Matrix: PUT state event ai.krill.agent
                  (a la room #krill-agents)
```

### 2. Discovery
```
App → Matrix: GET state de #krill-agents
           ← Llista d'agents amb hash de verificació
```

### 3. Pairing
```
App → Agent: ai.krill.pair.request
         ← ai.krill.pair.response + token
```

### 4. Communication
```
App → Agent: m.room.message + ai.krill.auth.token
         ← m.room.message (resposta)
```

### 5. Senses
```
App → Agent: ai.krill.senses.update
         ← ai.krill.senses.updated

Agent → App: ai.krill.sense.request
          ← ai.krill.sense.data
```

---

## Plugins Krill

### krill-enrollment-plugin
**Funció:** Registra agents al servidor Matrix

**Events:**
- Publica `ai.krill.agent` state events
- Genera verification hash amb HMAC

**Config:**
```yaml
gatewayId: "gateway-001"
gatewaySecret: "secret-key"
agents:
  - mxid: "@jarvis:server"
    displayName: "Jarvis"
```

### krill-pairing-plugin
**Funció:** Gestiona pairings usuari-agent

**Events:**
- `ai.krill.pair.request` → Processa
- `ai.krill.pair.response` → Envia
- `ai.krill.pair.revoke` → Processa

**Storage:**
- Pairings amb hash del token
- Senses per pairing

### krill-safe-plugin
**Funció:** Valida autenticació de missatges

**Intercepta:**
- Tots els missatges Matrix entrants
- Extreu `ai.krill.auth.pairing_token`
- Valida contra pairings

**Accions:**
- ✅ Token vàlid → Passa a l'agent
- ❌ Token invàlid → `ai.krill.auth.required`

---

## Seguretat

### Autenticació d'Agents
- Hash = HMAC-SHA256(secret, agent_mxid|gateway_id|timestamp)
- El secret mai surt del gateway
- L'app pot verificar agents

### Tokens de Pairing
- Format: `krill_tk_v1_{random_32_bytes_base64url}`
- Es retorna només UN cop
- Es guarda com a hash al gateway
- L'app el guarda al Keychain/Keystore

### Transport
- Matrix usa HTTPS
- Cloudflare proporciona TLS
- E2EE opcional amb Matrix encryption

---

## Deployment

### Requisits
- Synapse server (o altre Matrix homeserver)
- Clawdbot amb plugins Krill
- Cloudflare tunnel (o altre reverse proxy)

### Configuració Recomanada
```
Internet
    │
    ▼
Cloudflare Tunnel
    │
    ├──► matrix.example.com (Synapse, port 8008)
    │
    └──► (NO gateway exposed - només Matrix!)
```

El gateway NO s'exposa a internet. Tot passa per Matrix.

---

## Documents Relacionats

- [FULL-PROTOCOL.md](FULL-PROTOCOL.md) - Especificació completa
- [ARCHITECTURE-MATRIX.md](ARCHITECTURE-MATRIX.md) - Detalls tècnics Matrix
- [KRILL-APP-FLOW.md](KRILL-APP-FLOW.md) - Flux de l'app
