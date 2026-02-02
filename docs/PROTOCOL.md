# Krill Protocol Specification v1.0

> **ai.krill** - Protocol de comunicació Agent-Mòbil sobre Matrix

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
│                         MATRIX HOMESERVER                                   │
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

## Tipus de Missatges

Tots els missatges segueixen l'estructura:

```json
{
  "type": "ai.krill.<categoria>.<acció>",
  "content": { ... }
}
```

### Namespace Hierarchy

```
ai.krill.
├── verify.           # Verificació d'agents
│   ├── request
│   └── response
├── pair.             # Pairing dispositiu-agent
│   ├── request
│   ├── response
│   ├── revoke
│   ├── revoked
│   └── complete
├── senses.           # Permisos de sensors
│   ├── update
│   └── updated
├── location.         # Dades de localització
│   └── update
├── photo.            # Captures de càmera
│   └── captured
└── auth.             # Autenticació (dins content)
    └── pairing_token
```

---

## 1. Verificació d'Agents

### 1.1 `ai.krill.verify.request`

**Direcció**: App → Agent  
**Interceptat**: ✅ Sí  
**Propòsit**: Verificar que un agent és un Krill Agent vàlid

```json
{
  "type": "ai.krill.verify.request",
  "content": {
    "challenge": "abc123xyz",
    "timestamp": 1700000000,
    "app_version": "1.0.0",
    "platform": "ios"
  }
}
```

| Camp | Tipus | Descripció |
|------|-------|------------|
| `challenge` | string | Cadena aleatòria per prevenir replay attacks |
| `timestamp` | number | Unix timestamp (segons) |
| `app_version` | string | Versió de Krill App |
| `platform` | string | `ios` \| `android` |

### 1.2 `ai.krill.verify.response`

**Direcció**: Agent → App  
**Generat per**: Interceptor  
**Propòsit**: Confirmar identitat de l'agent

```json
{
  "type": "ai.krill.verify.response",
  "content": {
    "challenge": "abc123xyz",
    "verified": true,
    "agent": {
      "mxid": "@jarvis:matrix.silverbacking.ai",
      "display_name": "Jarvis",
      "gateway_id": "jarvis-gateway-001",
      "capabilities": ["chat", "senses", "calendar", "location"],
      "status": "online"
    },
    "responded_at": 1700000001
  }
}
```

| Camp | Tipus | Descripció |
|------|-------|------------|
| `challenge` | string | Echo del challenge rebut |
| `verified` | boolean | `true` si l'agent és vàlid |
| `agent.mxid` | string | Matrix ID de l'agent |
| `agent.display_name` | string | Nom visible de l'agent |
| `agent.gateway_id` | string | Identificador del gateway |
| `agent.capabilities` | string[] | Capacitats suportades |
| `agent.status` | string | `online` \| `offline` \| `busy` |
| `responded_at` | number | Unix timestamp de la resposta |

#### Errors possibles

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

## 2. Pairing (Aparellament)

### 2.1 `ai.krill.pair.request`

**Direcció**: App → Agent  
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
    "timestamp": 1700000000,
    "requested_capabilities": ["chat", "location", "camera"]
  }
}
```

| Camp | Tipus | Descripció |
|------|-------|------------|
| `device_id` | string | Identificador únic del dispositiu |
| `device_name` | string | Nom amigable del dispositiu |
| `device_type` | string | `mobile` \| `tablet` \| `desktop` |
| `platform` | string | `ios` \| `android` |
| `app_version` | string | Versió de Krill App |
| `timestamp` | number | Unix timestamp |
| `requested_capabilities` | string[] | Capacitats sol·licitades |

### 2.2 `ai.krill.pair.response`

**Direcció**: Agent → App  
**Generat per**: Interceptor  
**Propòsit**: Retornar token de pairing

```json
{
  "type": "ai.krill.pair.response",
  "content": {
    "success": true,
    "pairing_id": "pair_a1b2c3d4e5f6g7h8",
    "pairing_token": "krill_tk_v1_Abc123...",
    "agent": {
      "mxid": "@jarvis:matrix.silverbacking.ai",
      "display_name": "Jarvis",
      "capabilities": ["chat", "senses", "calendar", "location"]
    },
    "created_at": 1700000001,
    "message": "Hola! Ara estem connectats. Què puc fer per tu?"
  }
}
```

| Camp | Tipus | Descripció |
|------|-------|------------|
| `success` | boolean | `true` si el pairing va bé |
| `pairing_id` | string | ID únic del pairing (`pair_<hex>`) |
| `pairing_token` | string | Token secret (`krill_tk_v1_<base64url>`) |
| `agent` | object | Informació de l'agent |
| `created_at` | number | Unix timestamp |
| `message` | string | Missatge de benvinguda |

#### Token Format

```
krill_tk_v1_<32 bytes random en base64url>
```

Exemple: `krill_tk_v1_XyZ123AbC456DeF789GhI012JkL345MnO678PqR901StU`

⚠️ **IMPORTANT**: El token només s'envia una vegada. L'app l'ha de guardar de forma segura (Keychain/Keystore).

### 2.3 `ai.krill.pair.revoke`

**Direcció**: App → Agent  
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

### 2.4 `ai.krill.pair.revoked`

**Direcció**: Agent → App  
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

### 2.5 `ai.krill.pair.complete`

**Direcció**: App → Agent  
**Interceptat**: ⚠️ Parcialment (genera notificació)  
**Propòsit**: Event Matrix personalitzat per notificar pairing completat

```json
{
  "type": "ai.krill.pair.complete",
  "content": {
    "user_id": "@carles:matrix.silverbacking.ai",
    "platform": "ios",
    "paired_at": "2026-02-02T14:00:00Z"
  }
}
```

Aquest event genera una notificació visible a l'agent:

```
🦐 **New Krill Connection!**

**Carles** just paired with you via Krill App.

• **User ID:** @carles:matrix.silverbacking.ai
• **Platform:** ios
• **Time:** 2/2/2026, 2:00:00 PM

Say hello and introduce yourself! 👋
```

---

## 3. Senses (Permisos de Sensors)

### 3.1 `ai.krill.senses.update`

**Direcció**: App → Agent  
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

| Sense | Descripció |
|-------|------------|
| `location` | Accés a GPS/ubicació |
| `camera` | Accés a càmera |
| `microphone` | Accés a micròfon |
| `notifications` | Enviar notificacions push |
| `calendar` | Accés a calendari |
| `contacts` | Accés a contactes |
| `photos` | Accés a galeria de fotos |

### 3.2 `ai.krill.senses.updated`

**Direcció**: Agent → App  
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

---

## 4. Location Updates

### 4.1 `ai.krill.location.update`

**Direcció**: App → Agent  
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
      "speed": 0,
      "heading": 45,
      "timestamp": 1700000000
    },
    "context": {
      "battery_level": 85,
      "charging": false,
      "network_type": "wifi"
    }
  }
}
```

---

## 5. Missatges Autenticats (Opció B)

L'autenticació de missatges utilitza **Opció B**: camp `ai.krill.auth` dins del event content de Matrix.
Això manté compatibilitat total amb altres clients Matrix (veuen el missatge normal).

### 5.1 Format del missatge autenticat

```json
// Event Matrix m.room.message
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
| `ai.krill.auth` | Camp extra amb autenticació (ignorat per clients normals) |
| `pairing_token` | Token obtingut durant pairing |

### 5.2 Flux d'autenticació

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
       │                                  │ • Device: iPhone de Carles       │
       │                                  │ • Authenticated: ✓               │
       │                                  │ • Senses: location, camera       │
       │                                  │                                  │
       │                                  │ + missatge original              │
       │                                  │ ────────────────────────────────>│
       │                                  │                                  │
```

### 5.3 Context injectat a l'agent

Quan un missatge està autenticat, l'agent rep:

```
[Krill Context]
• Device: iPhone de Carles
• Authenticated: ✓
• Senses enabled: location, camera

Hola Jarvis, quin temps fa?
[matrix event id: $abc123 room: !xyz789]
```

### 5.4 Casos d'ús

| Escenari | Autenticat | Context a l'agent |
|----------|------------|-------------------|
| Missatge des de Krill App amb pairing | ✓ Sí | Context complet + senses |
| Missatge des de Krill App sense pairing | ✗ No | Només missatge |
| Missatge des d'Element/altre client | ✗ No | Només missatge |
| Missatge de protocol (JSON) | N/A | Interceptat |

### 5.5 Seguretat

- **Token mai exposat**: L'agent no veu el token, només el context
- **Validació estricta**: Sender Matrix ha de coincidir amb el pairing
- **Transparència**: Altres clients Matrix funcionen normalment

---

## 6. Flux Complet d'Exemple

### Escenari: Primera connexió d'un usuari

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
       │ 8. "Hola Jarvis!"                 │                                   │
       │ ─────────────────────────────────>│                                   │
       │                                   │ (text normal, NO interceptat)     │
       │                                   │ ─────────────────────────────────>│
       │                                   │                                   │ (processa)
       │                                   │ <─────────────────────────────────│
       │ 9. "Hola! Sóc Jarvis..."          │                                   │
       │ <─────────────────────────────────│                                   │
       │                                   │                                   │
```

---

## 7. Emmagatzematge de Pairings

Els pairings es guarden a:

```
~/.clawdbot/krill/pairings.json
```

Format:

```json
{
  "pairings": {
    "pair_a1b2c3d4e5f6g7h8": {
      "pairing_id": "pair_a1b2c3d4e5f6g7h8",
      "pairing_token_hash": "sha256_hash_del_token",
      "agent_mxid": "@jarvis:matrix.silverbacking.ai",
      "user_mxid": "@carles:matrix.silverbacking.ai",
      "device_id": "iPhone-ABC123",
      "device_name": "iPhone de Carles",
      "created_at": 1700000000,
      "last_seen_at": 1700001000,
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

## 8. Codis d'Error

| Codi | Descripció |
|------|------------|
| `NOT_CONFIGURED` | L'interceptor no té config vàlida |
| `INVALID_TOKEN` | El pairing_token no és vàlid |
| `PAIRING_NOT_FOUND` | No existeix el pairing |
| `EXPIRED_TOKEN` | El token ha caducat |
| `CAPABILITY_DENIED` | Capacitat no permesa |
| `RATE_LIMITED` | Massa peticions |

---

## 9. Configuració del Plugin

```json
{
  "plugins": {
    "entries": {
      "krill-matrix": {
        "enabled": true,
        "config": {
          "gatewayId": "jarvis-gateway-001",
          "gatewaySecret": "<secret-32-bytes-hex>",
          "agents": [
            {
              "mxid": "@jarvis:matrix.silverbacking.ai",
              "displayName": "Jarvis",
              "capabilities": ["chat", "senses", "calendar", "location"]
            }
          ]
        }
      }
    }
  }
}
```

---

## 10. Capacitats Suportades

| Capability | Descripció | Requereix Senses |
|------------|------------|------------------|
| `chat` | Missatgeria bàsica | No |
| `senses` | Control de sensors | No |
| `location` | Accés a ubicació | `location: true` |
| `camera` | Accés a càmera | `camera: true` |
| `calendar` | Accés a calendari | `calendar: true` |
| `notifications` | Enviar notificacions | `notifications: true` |
| `contacts` | Accés a contactes | `contacts: true` |

---

## Apèndix A: Diagrama de Seqüència Complet

```
┌─────────┐          ┌──────────┐          ┌─────────────┐          ┌───────┐
│   App   │          │  Matrix  │          │ Interceptor │          │ Agent │
└────┬────┘          └────┬─────┘          └──────┬──────┘          └───┬───┘
     │                    │                       │                     │
     │ m.text (JSON)      │                       │                     │
     │───────────────────>│                       │                     │
     │                    │ room.message          │                     │
     │                    │──────────────────────>│                     │
     │                    │                       │                     │
     │                    │                       │ parseKrillMessage() │
     │                    │                       │──────┐              │
     │                    │                       │      │              │
     │                    │                       │<─────┘              │
     │                    │                       │                     │
     │                    │     ┌─────────────────┴─────────────────┐   │
     │                    │     │ if ai.krill.* → handle internally │   │
     │                    │     │ else → pass to agent              │   │
     │                    │     └─────────────────┬─────────────────┘   │
     │                    │                       │                     │
     │                    │ m.text (response)     │                     │
     │<───────────────────│<──────────────────────│                     │
     │                    │                       │                     │
```

---

## Apèndix B: Migració des de Protocol Manual

Si anteriorment l'agent processava missatges Krill manualment (TOOLS.md), ara l'interceptor s'encarrega automàticament. No cal fer res - els missatges `ai.krill.*` mai arribaran a l'agent.

---

## Historial de Versions

| Versió | Data | Canvis |
|--------|------|--------|
| 1.0 | 2026-02-02 | Primera versió amb interceptor |

---

*Document generat per Jarvis · Silverbacking AI · 2026*
