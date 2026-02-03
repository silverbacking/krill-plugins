# Krill Protocol Specification v1.1

> **ai.krill** - Protocol de comunicació Agent-Mòbil sobre Matrix

**Versió:** 1.1  
**Data:** 2026-02-02  
**Estat:** Implementat

---

## Visió General

El protocol Krill permet que aplicacions mòbils es comuniquin amb agents IA a través de Matrix d'una manera estructurada i segura. Utilitza missatges JSON amb namespace `ai.krill.*` que són interceptats per la capa de transport abans d'arribar a l'agent.

### Principis de Disseny

1. **Transport Agnòstic**: Funciona sobre qualsevol client Matrix estàndard
2. **Interceptat per Codi**: Els missatges del protocol mai arriben a l'agent - són processats per l'interceptor
3. **Seguretat per Token**: Tota comunicació post-pairing requereix un token signat
4. **Retrocompatible**: Els missatges normals de text funcionen igual que sempre

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              KRILL APP (Mòbil)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Scanner   │  │   Pairing   │  │   Senses    │  │   Chat Interface    │ │
│  │   (QR/NFC)  │  │   Manager   │  │   Manager   │  │   (missatges text)  │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
└─────────┼────────────────┼────────────────┼────────────────────┼────────────┘
          │                │                │                    │
          ▼                ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MATRIX HOMESERVER (matrix.krillbot.app)                  │
│                    (missatges m.text amb JSON)                              │
└─────────────────────────────────────────────────────────────────────────────┘
          │                │                │                    │
          ▼                ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    KRILL-MATRIX-PLUGIN (Interceptor)                        │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        interceptKrillMessage()                        │   │
│  │                                                                       │   │
│  │   if (message.startsWith("{") && type.startsWith("ai.krill."))       │   │
│  │       → handleVerifyRequest()     [ai.krill.verify.*]                │   │
│  │       → handlePairRequest()       [ai.krill.pair.*]                  │   │
│  │       → handleSensesUpdate()      [ai.krill.senses.*]                │   │
│  │       → return { handled: true }  (NO passa a l'agent)               │   │
│  │   else                                                                │   │
│  │       → return { handled: false } (passa a l'agent)                  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
          │                                                      │
          │ (respostes protocol)                                 │ (text normal)
          ▼                                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AGENT (LLM)                                    │
│                     (només rep missatges de text normal)                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Namespace Complet

Tots els missatges segueixen l'estructura:

```json
{
  "type": "ai.krill.<categoria>.<acció>",
  "content": { ... }
}
```

### Jerarquia d'Events

```
ai.krill.
├── agent                    # State event: agent registrat
├── verify.                  # Verificació d'agents
│   ├── request
│   └── response
├── pair.                    # Pairing dispositiu-agent
│   ├── request
│   ├── response
│   ├── revoke
│   ├── revoked
│   └── complete
├── senses.                  # Permisos de sensors
│   ├── update
│   └── updated
├── location.                # Dades de localització
│   └── update
├── photo.                   # Captures de càmera
│   └── captured
├── plugin.                  # Actualitzacions de plugins
│   └── update
└── auth                     # Autenticació (dins content)
    └── pairing_token
```

---

## Taula de Referència Ràpida

| Event | Tipus | Direcció | Interceptat | Descripció |
|-------|-------|----------|-------------|------------|
| `ai.krill.agent` | State | Gateway → Room | N/A | Registre d'agent |
| `ai.krill.verify.request` | Message | App → Gateway | ✅ | Sol·licita verificació |
| `ai.krill.verify.response` | Message | Gateway → App | N/A | Respon verificació |
| `ai.krill.pair.request` | Message | App → Gateway | ✅ | Sol·licita pairing |
| `ai.krill.pair.response` | Message | Gateway → App | N/A | Token de pairing |
| `ai.krill.pair.revoke` | Message | App → Gateway | ✅ | Revoca pairing |
| `ai.krill.pair.revoked` | Message | Gateway → App | N/A | Confirma revocació |
| `ai.krill.pair.complete` | Custom | App → Gateway | ⚠️ | Notifica agent |
| `ai.krill.senses.update` | Message | App → Gateway | ✅ | Actualitza permisos |
| `ai.krill.senses.updated` | Message | Gateway → App | N/A | Confirma permisos |
| `ai.krill.location.update` | Message | App → Gateway | ❌ | Envia ubicació |
| `ai.krill.photo.captured` | Message | App → Gateway | ❌ | Envia foto |
| `ai.krill.plugin.update` | Message | Cloud → Gateway | ✅ | Notifica update |
| `ai.krill.auth` | Field | App → Gateway | ❌ | Auth en missatges |

---

# Part 1: Enrollment (Registre d'Agents)

## 1.1 State Event: `ai.krill.agent`

**Tipus:** State Event  
**Room:** `#krill-agents:matrix.krillbot.app` (Registry Room)  
**state_key:** MXID de l'agent

Registra un agent al directori públic perquè els usuaris el puguin descobrir.

```json
{
  "type": "ai.krill.agent",
  "state_key": "@jarvis:matrix.krillbot.app",
  "content": {
    "gateway_id": "jarvis-gateway-001",
    "gateway_url": "https://gateway.example.com",
    "display_name": "Jarvis",
    "description": "Personal AI assistant",
    "capabilities": ["chat", "senses", "calendar", "location"],
    "enrolled_at": 1706889600,
    "verification_hash": "abc123def456..."
  }
}
```

| Camp | Tipus | Requerit | Descripció |
|------|-------|----------|------------|
| `gateway_id` | string | ✅ | Identificador únic del gateway |
| `gateway_url` | string | ❌ | URL pública del gateway (opcional) |
| `display_name` | string | ✅ | Nom visible de l'agent |
| `description` | string | ❌ | Descripció breu |
| `capabilities` | string[] | ✅ | Capacitats suportades |
| `enrolled_at` | number | ✅ | Unix timestamp del registre |
| `verification_hash` | string | ✅ | HMAC-SHA256 per verificar |

### Generació del `verification_hash`

```javascript
const message = `${agent_mxid}|${gateway_id}|${enrolled_at}`;
const hash = HMAC_SHA256(gateway_secret, message).hex();
```

---

# Part 2: Verificació

## 2.1 `ai.krill.verify.request`

**Direcció**: App → Gateway  
**Interceptat**: ✅ Sí  
**Propòsit**: Verificar que un agent és un Krill Agent vàlid

```json
{
  "type": "ai.krill.verify.request",
  "content": {
    "challenge": "abc123xyz789",
    "timestamp": 1706889600,
    "app_version": "1.0.0",
    "platform": "ios"
  }
}
```

| Camp | Tipus | Requerit | Descripció |
|------|-------|----------|------------|
| `challenge` | string | ✅ | Cadena aleatòria (prevé replay attacks) |
| `timestamp` | number | ✅ | Unix timestamp (segons) |
| `app_version` | string | ❌ | Versió de Krill App |
| `platform` | string | ❌ | `ios` \| `android` |

## 2.2 `ai.krill.verify.response`

**Direcció**: Gateway → App  
**Generat per**: Interceptor  
**Propòsit**: Confirmar identitat de l'agent

```json
{
  "type": "ai.krill.verify.response",
  "content": {
    "challenge": "abc123xyz789",
    "verified": true,
    "agent": {
      "mxid": "@jarvis:matrix.krillbot.app",
      "display_name": "Jarvis",
      "gateway_id": "jarvis-gateway-001",
      "capabilities": ["chat", "senses", "calendar", "location"],
      "status": "online"
    },
    "responded_at": 1706889601
  }
}
```

| Camp | Tipus | Descripció |
|------|-------|------------|
| `challenge` | string | Echo del challenge rebut |
| `verified` | boolean | `true` si l'agent és vàlid |
| `agent.mxid` | string | Matrix ID de l'agent |
| `agent.display_name` | string | Nom visible |
| `agent.gateway_id` | string | ID del gateway |
| `agent.capabilities` | string[] | Capacitats suportades |
| `agent.status` | string | `online` \| `offline` \| `busy` |
| `responded_at` | number | Unix timestamp de la resposta |

### Resposta d'Error

```json
{
  "type": "ai.krill.verify.response",
  "content": {
    "verified": false,
    "error": "NOT_CONFIGURED"
  }
}
```

---

# Part 3: Pairing (Aparellament)

## 3.1 `ai.krill.pair.request`

**Direcció**: App → Gateway  
**Interceptat**: ✅ Sí  
**Propòsit**: Sol·licitar aparellament amb un agent

```json
{
  "type": "ai.krill.pair.request",
  "content": {
    "device_id": "iPhone-ABC123",
    "device_name": "iPhone de Carles",
    "device_type": "mobile",
    "platform": "ios",
    "app_version": "1.0.0",
    "timestamp": 1706889600,
    "requested_capabilities": ["chat", "location", "camera"]
  }
}
```

| Camp | Tipus | Requerit | Descripció |
|------|-------|----------|------------|
| `device_id` | string | ✅ | Identificador únic del dispositiu |
| `device_name` | string | ✅ | Nom amigable |
| `device_type` | string | ❌ | `mobile` \| `tablet` \| `desktop` |
| `platform` | string | ❌ | `ios` \| `android` |
| `app_version` | string | ❌ | Versió de Krill App |
| `timestamp` | number | ❌ | Unix timestamp |
| `requested_capabilities` | string[] | ❌ | Capacitats sol·licitades |

## 3.2 `ai.krill.pair.response`

**Direcció**: Gateway → App  
**Generat per**: Interceptor  
**Propòsit**: Retornar token de pairing

```json
{
  "type": "ai.krill.pair.response",
  "content": {
    "success": true,
    "pairing_id": "pair_a1b2c3d4e5f6g7h8",
    "pairing_token": "krill_tk_v1_XyZ123AbC456DeF789...",
    "agent": {
      "mxid": "@jarvis:matrix.krillbot.app",
      "display_name": "Jarvis",
      "capabilities": ["chat", "senses", "calendar", "location"]
    },
    "created_at": 1706889601,
    "message": "Hola! Ara estem connectats. Què puc fer per tu?"
  }
}
```

| Camp | Tipus | Descripció |
|------|-------|------------|
| `success` | boolean | `true` si el pairing va bé |
| `pairing_id` | string | ID únic del pairing |
| `pairing_token` | string | Token secret (només s'envia una vegada!) |
| `agent` | object | Informació de l'agent |
| `created_at` | number | Unix timestamp |
| `message` | string | Missatge de benvinguda |

### Format del Token

```
krill_tk_v1_<32 bytes random en base64url>
```

Exemple: `krill_tk_v1_XyZ123AbC456DeF789GhI012JkL345MnO678PqR901StU`

⚠️ **IMPORTANT**: El token només s'envia una vegada. L'app l'ha de guardar de forma segura (Keychain/Keystore).

### Resposta d'Error

```json
{
  "type": "ai.krill.pair.response",
  "content": {
    "success": false,
    "error": "NOT_CONFIGURED"
  }
}
```

## 3.3 `ai.krill.pair.revoke`

**Direcció**: App → Gateway  
**Interceptat**: ✅ Sí  
**Propòsit**: Desaparellar un dispositiu

```json
{
  "type": "ai.krill.pair.revoke",
  "content": {
    "pairing_token": "krill_tk_v1_..."
  }
}
```

## 3.4 `ai.krill.pair.revoked`

**Direcció**: Gateway → App  
**Generat per**: Interceptor  
**Propòsit**: Confirmar desaparellament

```json
{
  "type": "ai.krill.pair.revoked",
  "content": {
    "success": true,
    "message": "Pairing revocat. Fins aviat!"
  }
}
```

### Resposta d'Error

```json
{
  "type": "ai.krill.pair.revoked",
  "content": {
    "success": false,
    "error": "PAIRING_NOT_FOUND"
  }
}
```

## 3.5 `ai.krill.pair.complete`

**Direcció**: App → Gateway  
**Tipus**: Custom Matrix Event  
**Interceptat**: ⚠️ Parcialment (genera notificació a l'agent)  
**Propòsit**: Notificar l'agent que el pairing s'ha completat

```json
{
  "type": "ai.krill.pair.complete",
  "content": {
    "user_id": "@carles:matrix.krillbot.app",
    "platform": "ios",
    "paired_at": "2026-02-02T14:00:00Z"
  }
}
```

Aquest event genera una notificació visible a l'agent:

```
🦐 **New Krill Connection!**

**Carles** just paired with you via Krill App.

• **User ID:** @carles:matrix.krillbot.app
• **Platform:** ios
• **Time:** 2/2/2026, 2:00:00 PM

Say hello and introduce yourself! 👋
```

---

# Part 4: Senses (Permisos de Sensors)

## 4.1 `ai.krill.senses.update`

**Direcció**: App → Gateway  
**Interceptat**: ✅ Sí  
**Propòsit**: Actualitzar permisos de sensors

```json
{
  "type": "ai.krill.senses.update",
  "content": {
    "pairing_token": "krill_tk_v1_...",
    "senses": {
      "location": true,
      "camera": true,
      "microphone": false,
      "notifications": true,
      "calendar": false
    }
  }
}
```

### Senses Disponibles

| Sense | Descripció |
|-------|------------|
| `location` | Accés a GPS/ubicació |
| `camera` | Accés a càmera |
| `microphone` | Accés a micròfon |
| `notifications` | Enviar notificacions push |
| `calendar` | Accés a calendari |
| `contacts` | Accés a contactes |
| `photos` | Accés a galeria de fotos |
| `health` | Accés a dades de salut |
| `motion` | Accés a sensors de moviment |

## 4.2 `ai.krill.senses.updated`

**Direcció**: Gateway → App  
**Generat per**: Interceptor  
**Propòsit**: Confirmar actualització de permisos

```json
{
  "type": "ai.krill.senses.updated",
  "content": {
    "success": true,
    "senses": {
      "location": true,
      "camera": true,
      "microphone": false,
      "notifications": true,
      "calendar": false
    }
  }
}
```

### Resposta d'Error

```json
{
  "type": "ai.krill.senses.updated",
  "content": {
    "success": false,
    "error": "INVALID_TOKEN"
  }
}
```

---

# Part 5: Dades de Sensors

## 5.1 `ai.krill.location.update`

**Direcció**: App → Gateway  
**Interceptat**: ❌ No (passa a l'agent amb context)  
**Propòsit**: Enviar actualització de localització

```json
{
  "type": "ai.krill.location.update",
  "content": {
    "pairing_token": "krill_tk_v1_...",
    "location": {
      "latitude": 25.6866,
      "longitude": -100.3161,
      "accuracy": 10.5,
      "altitude": 540,
      "altitude_accuracy": 5.0,
      "speed": 0,
      "heading": 45,
      "timestamp": 1706889600
    },
    "context": {
      "battery_level": 85,
      "charging": false,
      "network_type": "wifi"
    }
  }
}
```

| Camp | Tipus | Descripció |
|------|-------|------------|
| `latitude` | number | Latitud (-90 a 90) |
| `longitude` | number | Longitud (-180 a 180) |
| `accuracy` | number | Precisió horitzontal (metres) |
| `altitude` | number | Altitud (metres sobre el nivell del mar) |
| `altitude_accuracy` | number | Precisió vertical (metres) |
| `speed` | number | Velocitat (m/s) |
| `heading` | number | Direcció (graus, 0-360) |
| `timestamp` | number | Unix timestamp |

## 5.2 `ai.krill.photo.captured`

**Direcció**: App → Gateway  
**Interceptat**: ❌ No (passa a l'agent)  
**Propòsit**: Enviar foto capturada

```json
{
  "type": "ai.krill.photo.captured",
  "content": {
    "pairing_token": "krill_tk_v1_...",
    "photo": {
      "mxc_url": "mxc://matrix.krillbot.app/abc123",
      "width": 1920,
      "height": 1080,
      "mime_type": "image/jpeg",
      "size_bytes": 245000
    },
    "camera": "back",
    "timestamp": 1706889600
  }
}
```

---

# Part 6: Autenticació de Missatges

## 6.1 Camp `ai.krill.auth`

L'autenticació de missatges normals utilitza un camp extra dins del event content de Matrix.
Això manté compatibilitat total amb altres clients Matrix.

### Format del Missatge Autenticat

```json
{
  "msgtype": "m.text",
  "body": "Hola Jarvis, quin temps fa?",
  "ai.krill.auth": {
    "pairing_token": "krill_tk_v1_..."
  }
}
```

| Camp | Descripció |
|------|------------|
| `msgtype` | Tipus de missatge Matrix estàndard |
| `body` | Text del missatge (visible per tots els clients) |
| `ai.krill.auth` | Camp extra amb autenticació |
| `pairing_token` | Token obtingut durant pairing |

### Flux d'Autenticació

```
┌─────────────┐                    ┌─────────────┐                    ┌─────────────┐
│  Krill App  │                    │ Interceptor │                    │    Agent    │
└──────┬──────┘                    └──────┬──────┘                    └──────┬──────┘
       │                                  │                                  │
       │ m.text + ai.krill.auth           │                                  │
       │ ─────────────────────────────────>                                  │
       │                                  │                                  │
       │                                  │ extractAuthFromEvent()           │
       │                                  │ ──────────┐                      │
       │                                  │           │ validate token       │
       │                                  │ <─────────┘                      │
       │                                  │                                  │
       │                                  │ buildAgentContext()              │
       │                                  │ ──────────┐                      │
       │                                  │           │ build context        │
       │                                  │ <─────────┘                      │
       │                                  │                                  │
       │                                  │ [Krill Context]                  │
       │                                  │ + missatge original              │
       │                                  │ ────────────────────────────────>│
       │                                  │                                  │
```

### Context Injectat a l'Agent

Quan un missatge està autenticat:

```
[Krill Context]
• Device: iPhone de Carles
• Authenticated: ✓
• Senses enabled: location, camera

Hola Jarvis, quin temps fa?
[matrix event id: $abc123 room: !xyz789]
```

### Casos d'Ús

| Escenari | Autenticat | Context a l'agent |
|----------|------------|-------------------|
| Missatge des de Krill App amb pairing | ✓ Sí | Context complet + senses |
| Missatge des de Krill App sense pairing | ✗ No | Només missatge |
| Missatge des d'Element/altre client | ✗ No | Només missatge |
| Missatge de protocol (JSON) | N/A | Interceptat |

---

# Part 7: Actualitzacions de Plugins

## 7.1 `ai.krill.plugin.update`

**Direcció**: Krill Cloud → Gateway  
**Transport**: Sala Matrix `#krill-updates:matrix.krillbot.app`  
**Interceptat**: ✅ Sí (pel krill-update-plugin)  
**Propòsit**: Notificar gateways d'una nova versió d'un plugin

```json
{
  "type": "m.room.message",
  "content": {
    "msgtype": "m.notice",
    "body": "New update: krill-enrollment v0.2.0",
    "ai.krill.plugin.update": {
      "plugin": "krill-enrollment",
      "version": "0.2.0",
      "changelog": "Added retry logic for Matrix API calls",
      "checksum": "sha256:a1b2c3d4e5f6...",
      "download_url": "https://api.krillbot.app/v1/plugins/download/krill-enrollment/0.2.0",
      "required": false,
      "min_gateway_version": "1.0.0",
      "published_at": "2026-02-02T12:00:00Z"
    }
  }
}
```

| Camp | Tipus | Descripció |
|------|-------|------------|
| `plugin` | string | Nom del plugin |
| `version` | string | Nova versió (semver) |
| `changelog` | string | Descripció dels canvis |
| `checksum` | string | SHA256 del paquet (`sha256:...`) |
| `download_url` | string | URL de descàrrega (requereix auth) |
| `required` | boolean | Si és un update obligatori |
| `min_gateway_version` | string | Versió mínima del gateway |
| `published_at` | string | ISO timestamp de publicació |

### Flux d'Actualització

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Krill Cloud    │         │ #krill-updates  │         │    Gateway      │
│  (Publisher)    │         │  (Matrix Room)  │         │ (krill-update)  │
└────────┬────────┘         └────────┬────────┘         └────────┬────────┘
         │                           │                           │
         │ m.room.message            │                           │
         │ + ai.krill.plugin.update  │                           │
         │ ──────────────────────────>                           │
         │                           │                           │
         │                           │ sync                      │
         │                           │ ────────────────────────> │
         │                           │                           │
         │                           │                           │ detect update
         │                           │                           │ ────────┐
         │                           │                           │         │
         │                           │                           │ <───────┘
         │                           │                           │
         │                           │                           │ download
         │ <──────────────────────────────────────────────────── │
         │                           │                           │ (with auth)
         │  .tgz file                │                           │
         │ ──────────────────────────────────────────────────────>
         │                           │                           │
         │                           │                           │ verify checksum
         │                           │                           │ npm install -g
         │                           │                           │ log restart needed
         │                           │                           │
```

### Autenticació de Descàrrega

Les descàrregues requereixen un header d'autenticació:

```
X-Krill-Auth: <gatewayId>:<timestamp>:<signature>
```

On:
```javascript
const message = `${gatewayId}:${timestamp}:${plugin}:${version}`;
const signature = HMAC_SHA256(gatewaySecret, message).hex().substring(0, 32);
```

---

# Part 8: API HTTP (Krill Cloud)

## Endpoints de l'API

Base URL: `https://api.krillbot.app`

### 8.1 Enrollment

#### `POST /v1/agents/prepare-enrollment`

Prepara les dades per registrar un agent.

**Request:**
```json
{
  "mxid": "@jarvis:matrix.krillbot.app",
  "gateway_id": "jarvis-gateway-001",
  "gateway_secret": "...",
  "display_name": "Jarvis",
  "description": "Personal AI assistant",
  "capabilities": ["chat", "senses"]
}
```

**Response:**
```json
{
  "enrollment": {
    "event_type": "ai.krill.agent",
    "state_key": "@jarvis:matrix.krillbot.app",
    "content": {
      "gateway_id": "jarvis-gateway-001",
      "display_name": "Jarvis",
      "capabilities": ["chat", "senses"],
      "enrolled_at": 1706889600,
      "verification_hash": "abc123..."
    }
  }
}
```

### 8.2 Plugin Updates

#### `POST /v1/plugins/check-updates`

Comprova si hi ha updates disponibles.

**Request:**
```json
{
  "installed": {
    "krill-enrollment": "0.1.0",
    "krill-update": "1.0.0",
    "krill-matrix": "0.1.0"
  }
}
```

**Response:**
```json
{
  "has_updates": true,
  "updates": [
    {
      "plugin": "krill-enrollment",
      "current": "0.1.0",
      "latest": "0.2.0",
      "download_url": "https://api.krillbot.app/v1/plugins/download/...",
      "checksum": "sha256:...",
      "required": false
    }
  ]
}
```

#### `GET /v1/plugins/download/{plugin}/{version}`

Descarrega un paquet de plugin.

**Headers:**
```
X-Krill-Auth: gatewayId:timestamp:signature
```

**Response:** Binary `.tgz` file

### 8.3 Health

#### `GET /health`

**Response:**
```json
{
  "status": "ok"
}
```

---

# Part 9: API HTTP (Gateway Local)

## Endpoints del Gateway

Base URL: `http://localhost:18789` (o el port configurat)

### 9.1 Enrollment

#### `POST /krill/verify`

Verifica un agent.

**Request:**
```json
{
  "agent_mxid": "@jarvis:matrix.krillbot.app",
  "gateway_id": "jarvis-gateway-001",
  "verification_hash": "abc123...",
  "enrolled_at": 1706889600
}
```

**Response:**
```json
{
  "valid": true,
  "agent": {
    "mxid": "@jarvis:matrix.krillbot.app",
    "display_name": "Jarvis",
    "capabilities": ["chat", "senses"],
    "status": "online"
  }
}
```

#### `POST /krill/enroll`

Genera dades d'enrollment.

#### `GET /krill/agents`

Llista agents configurats.

### 9.2 Pairing

#### `POST /krill/pair`

Crea un nou pairing.

**Request:**
```json
{
  "agent_mxid": "@jarvis:matrix.krillbot.app",
  "user_mxid": "@carles:matrix.krillbot.app",
  "device_id": "iPhone-ABC123",
  "device_name": "iPhone de Carles"
}
```

**Response:**
```json
{
  "success": true,
  "pairing": {
    "pairing_id": "pair_a1b2c3d4",
    "pairing_token": "krill_tk_v1_...",
    "agent_mxid": "@jarvis:matrix.krillbot.app",
    "created_at": 1706889600
  }
}
```

#### `GET /krill/pairings`

Llista pairings actius.

**Query params:**
- `agent`: Filtra per agent MXID

#### `DELETE /krill/pair/{pairing_id}`

Revoca un pairing.

#### `POST /krill/pair/{pairing_id}/senses`

Actualitza senses d'un pairing.

#### `POST /krill/validate`

Valida un pairing token.

**Request:**
```json
{
  "pairing_token": "krill_tk_v1_..."
}
```

**Response:**
```json
{
  "valid": true,
  "pairing": {
    "pairing_id": "pair_a1b2c3d4",
    "agent_mxid": "@jarvis:matrix.krillbot.app",
    "user_mxid": "@carles:matrix.krillbot.app",
    "device_id": "iPhone-ABC123",
    "senses": {"location": true}
  }
}
```

---

# Part 10: Emmagatzematge

## 10.1 Pairings Store

**Ubicació:** `~/.clawdbot/krill/pairings.json`

```json
{
  "pairings": {
    "pair_a1b2c3d4e5f6g7h8": {
      "pairing_id": "pair_a1b2c3d4e5f6g7h8",
      "pairing_token_hash": "sha256_hash_del_token",
      "agent_mxid": "@jarvis:matrix.krillbot.app",
      "user_mxid": "@carles:matrix.krillbot.app",
      "device_id": "iPhone-ABC123",
      "device_name": "iPhone de Carles",
      "device_type": "mobile",
      "created_at": 1706889600,
      "last_seen_at": 1706890000,
      "senses": {
        "location": true,
        "camera": true,
        "microphone": false
      }
    }
  }
}
```

⚠️ **Seguretat**: Mai es guarda el token en clar - només el hash SHA-256.

---

# Part 11: Codis d'Error

| Codi | Descripció |
|------|------------|
| `NOT_CONFIGURED` | El plugin no té configuració vàlida |
| `INVALID_TOKEN` | El pairing_token no és vàlid |
| `PAIRING_NOT_FOUND` | No existeix el pairing |
| `EXPIRED_TOKEN` | El token ha caducat |
| `CAPABILITY_DENIED` | Capacitat no permesa |
| `RATE_LIMITED` | Massa peticions |
| `SENDER_MISMATCH` | El sender no coincideix amb el pairing |
| `CHECKSUM_FAILED` | Verificació de checksum fallida |
| `GATEWAY_MISMATCH` | Gateway ID no coincideix |

---

# Part 12: Capacitats

| Capability | Descripció | Requereix Sense |
|------------|------------|-----------------|
| `chat` | Missatgeria bàsica | No |
| `senses` | Control de sensors | No |
| `location` | Accés a ubicació | `location: true` |
| `camera` | Accés a càmera | `camera: true` |
| `calendar` | Accés a calendari | `calendar: true` |
| `notifications` | Enviar notificacions | `notifications: true` |
| `contacts` | Accés a contactes | `contacts: true` |
| `voice` | Notes de veu | `microphone: true` |

---

# Part 13: Configuració dels Plugins

## krill-enrollment-plugin

```yaml
plugins:
  entries:
    krill-enrollment:
      enabled: true
      config:
        gatewayId: "jarvis-gateway-001"
        gatewaySecret: "your-super-secret-key-32-bytes"
        gatewayUrl: "https://gateway.example.com"
        agentsRoomId: "#krill-agents:matrix.krillbot.app"
        agents:
          - mxid: "@jarvis:matrix.krillbot.app"
            displayName: "Jarvis"
            description: "Personal AI assistant"
            capabilities: ["chat", "senses", "calendar", "location"]
```

## krill-pairing-plugin

```yaml
plugins:
  entries:
    krill-pairing:
      enabled: true
      config:
        storagePath: "~/.clawdbot/krill/pairings.json"
        tokenExpiry: 0  # 0 = never expires
```

## krill-matrix-plugin

```yaml
plugins:
  entries:
    krill-matrix:
      enabled: true
      config:
        gatewayId: "jarvis-gateway-001"
        gatewaySecret: "your-super-secret-key-32-bytes"
        autoProvision: false
        adminToken: "synapse-admin-token"  # opcional
        agents:
          - mxid: "@jarvis:matrix.krillbot.app"
            displayName: "Jarvis"
            capabilities: ["chat", "senses"]
```

## krill-update-plugin

```yaml
plugins:
  entries:
    krill-update:
      enabled: true
      config:
        apiUrl: "https://api.krillbot.app"
        updatesRoom: "!XEo07d0FSUQ7pUhNuteBMl4iRXsZy_PjKwBf7SdBAtk"
        autoUpdate: true
        checkIntervalMinutes: 60
        matrixHomeserver: "https://matrix.krillbot.app"
```

---

# Apèndix A: Diagrama de Seqüència Complet

## Primera Connexió d'un Usuari

```
┌──────────────┐                    ┌──────────────┐                    ┌──────────────┐
│  Krill App   │                    │  Interceptor │                    │    Agent     │
└──────┬───────┘                    └──────┬───────┘                    └──────┬───────┘
       │                                   │                                   │
       │ 1. Escaneja QR amb mxid           │                                   │
       │ ─────────────────────────────────>│                                   │
       │                                   │                                   │
       │ 2. ai.krill.verify.request        │                                   │
       │ ─────────────────────────────────>│                                   │
       │                                   │ (interceptat)                     │
       │                                   │                                   │
       │ 3. ai.krill.verify.response       │                                   │
       │ <─────────────────────────────────│                                   │
       │    {verified: true, agent: {...}} │                                   │
       │                                   │                                   │
       │ 4. ai.krill.pair.request          │                                   │
       │ ─────────────────────────────────>│                                   │
       │                                   │ (interceptat)                     │
       │                                   │                                   │
       │ 5. ai.krill.pair.response         │                                   │
       │ <─────────────────────────────────│                                   │
       │    {token: "krill_tk_v1_..."}     │                                   │
       │                                   │                                   │
       │ 6. ai.krill.senses.update         │                                   │
       │ ─────────────────────────────────>│                                   │
       │    {location: true, camera: true} │ (interceptat)                     │
       │                                   │                                   │
       │ 7. ai.krill.senses.updated        │                                   │
       │ <─────────────────────────────────│                                   │
       │                                   │                                   │
       │ 8. ai.krill.pair.complete         │                                   │
       │ ─────────────────────────────────>│                                   │
       │                                   │ (genera notificació)              │
       │                                   │ ─────────────────────────────────>│
       │                                   │   "🦐 New Krill Connection!"      │
       │                                   │                                   │
       │ 9. "Hola Jarvis!"                 │                                   │
       │    + ai.krill.auth                │                                   │
       │ ─────────────────────────────────>│                                   │
       │                                   │ (valida, afegeix context)         │
       │                                   │ ─────────────────────────────────>│
       │                                   │   [Krill Context] + missatge      │
       │                                   │                                   │ (processa)
       │                                   │ <─────────────────────────────────│
       │ 10. "Hola! Sóc Jarvis..."         │                                   │
       │ <─────────────────────────────────│                                   │
       │                                   │                                   │
```

---

# Apèndix B: Seguretat

## Principis

1. **Token mai exposat a l'agent**: L'LLM mai veu el pairing_token
2. **Hash per emmagatzematge**: Els tokens es guarden com a SHA-256
3. **HMAC per verificació**: Els verification_hash utilitzen HMAC-SHA256
4. **Validació de sender**: El sender Matrix ha de coincidir amb el pairing
5. **Transport segur**: Tot via HTTPS/Matrix amb TLS

## Recomanacions

- Regenerar `gatewaySecret` periòdicament
- Monitoritzar `last_seen_at` per detectar tokens inactius
- Implementar rate limiting als endpoints HTTP
- Fer backup dels pairings en entorns de producció

---

# Historial de Versions

| Versió | Data | Canvis |
|--------|------|--------|
| 1.0 | 2026-02-01 | Primera versió amb interceptor |
| 1.1 | 2026-02-02 | Afegit plugin updates, API HTTP, capacitats |

---

*Document generat per Jarvis · Silverbacking AI · 2026*
