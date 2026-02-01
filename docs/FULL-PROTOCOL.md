# Krill Protocol - Especificació Completa

## 1. Introducció

Krill és un protocol de comunicació segura entre usuaris humans (via Krill App) i agents IA 
(via OpenClaw/Clawdbot) sobre el protocol Matrix.

### 1.1 Objectius

- **Seguretat**: Autenticació mútua entre usuari i agent
- **Privacitat**: Tot passa per Matrix (E2EE possible)
- **Control**: L'usuari decideix quins permisos (senses) atorga
- **Portabilitat**: Funciona amb qualsevol servidor Matrix

### 1.2 Actors

| Actor | Descripció |
|-------|------------|
| **Krill App** | Aplicació mòbil (iOS/Android) que l'usuari fa servir |
| **KrillMatrix** | Servidor Matrix (Synapse) exposat públicament |
| **Gateway** | OpenClaw/Clawdbot que controla l'agent IA |
| **Agent** | Compte Matrix de l'agent (@jarvis:server) |

---

## 2. Enrollment (Registre d'Agents)

### 2.1 Room de Registre

Cada servidor KrillMatrix té una room pública que actua com a catàleg d'agents:

```
Alias: #krill-agents:matrix.example.com
```

### 2.2 State Event: ai.krill.agent

Cada agent es registra amb un state event:

```json
{
  "type": "ai.krill.agent",
  "state_key": "@jarvis:matrix.example.com",
  "sender": "@krill-admin:matrix.example.com",
  "content": {
    "gateway_id": "gateway-001",
    "gateway_url": "https://gateway.example.com",
    "display_name": "Jarvis",
    "description": "Personal AI assistant",
    "avatar_url": "mxc://matrix.example.com/abc123",
    "capabilities": ["chat", "senses", "calendar", "location"],
    "enrolled_at": 1706817600,
    "verification_hash": "a3f2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0"
  }
}
```

### 2.3 Verification Hash

El hash es calcula així:

```
verification_hash = HMAC-SHA256(
    key = gateway_secret,
    message = agent_mxid + "|" + gateway_id + "|" + enrolled_at
)
```

Això permet que Krill App pugui verificar que l'agent és autèntic contactant el gateway.

### 2.4 Descobriment d'Agents

Krill App:
1. Join a la room `#krill-agents:server`
2. GET `/rooms/{room_id}/state`
3. Filtra events `type = "ai.krill.agent"`
4. Mostra llista d'agents disponibles

---

## 3. Pairing (Emparellament)

### 3.1 Concepte

El pairing és el procés pel qual un usuari s'emparella amb un agent.

**Propietats:**
- Un pairing = un usuari + un dispositiu + un agent
- Genera un token compartit (secret)
- L'usuari pot tenir múltiples pairings (un per dispositiu)
- L'usuari pot revocar pairings

### 3.2 Flux de Pairing

```
┌─────────────┐                    ┌─────────────────┐
│  Krill App  │                    │  Gateway        │
│             │                    │  (@jarvis)      │
└──────┬──────┘                    └────────┬────────┘
       │                                    │
       │  1. Crear DM amb @jarvis           │
       │ ─────────────────────────────────► │
       │                                    │
       │  2. ai.krill.pair.request          │
       │ ─────────────────────────────────► │
       │                                    │
       │     3. Gateway valida i genera     │
       │        pairing_token               │
       │                                    │
       │  4. ai.krill.pair.response         │
       │ ◄───────────────────────────────── │
       │                                    │
       │     5. App guarda token            │
       │        (Keychain/Keystore)         │
       │                                    │
```

### 3.3 Event: ai.krill.pair.request

Enviat per Krill App a l'agent:

```json
{
  "type": "ai.krill.pair.request",
  "content": {
    "device_id": "IPHONE-ABC123",
    "device_name": "iPhone de Carles",
    "device_type": "ios",
    "device_model": "iPhone 15 Pro",
    "app_version": "1.0.0",
    "os_version": "17.2",
    "locale": "ca_ES"
  }
}
```

### 3.4 Event: ai.krill.pair.response

Respost pel gateway:

**Success:**
```json
{
  "type": "ai.krill.pair.response",
  "content": {
    "success": true,
    "pairing_id": "pair_d525760de7b34757",
    "pairing_token": "krill_tk_v1_rGgkHNr0ujPNOTh04b8psqzFUAb5NQweqgp2Pr6_F18",
    "agent": {
      "mxid": "@jarvis:matrix.example.com",
      "display_name": "Jarvis",
      "avatar_url": "mxc://...",
      "capabilities": ["chat", "senses", "calendar"]
    },
    "created_at": 1706817600,
    "message": "Hola! Ara estem connectats. Què puc fer per tu?"
  }
}
```

**Error:**
```json
{
  "type": "ai.krill.pair.response",
  "content": {
    "success": false,
    "error_code": "DEVICE_LIMIT_REACHED",
    "error": "Has arribat al límit de dispositius (5)",
    "message": "Si us plau, revoca un pairing existent abans de fer-ne un de nou."
  }
}
```

### 3.5 Format del Token

```
krill_tk_v1_{random_32_bytes_base64url}
```

El token:
- Es retorna només UN COP (durant el pairing)
- S'emmagatzema com a HASH al gateway
- L'app el guarda al Keychain (iOS) o Keystore (Android)
- No es pot recuperar si es perd → cal re-pairing

---

## 4. Comunicació Autenticada

### 4.1 Missatge amb Token

Cada missatge de Krill App inclou el token:

```json
{
  "type": "m.room.message",
  "content": {
    "msgtype": "m.text",
    "body": "Quin temps fa avui a Monterrey?",
    "ai.krill.auth": {
      "pairing_token": "krill_tk_v1_...",
      "timestamp": 1706820000,
      "nonce": "abc123"
    }
  }
}
```

### 4.2 Validació (krill-safe-plugin)

El gateway:
1. Extreu `content["ai.krill.auth"]["pairing_token"]`
2. Calcula `hash = SHA256(token)`
3. Cerca pairing amb aquest hash
4. Si vàlid → actualitza `last_seen_at` i processa
5. Si invàlid → respon amb `ai.krill.auth.required`

### 4.3 Event: ai.krill.auth.required

Quan el token és invàlid:

```json
{
  "type": "ai.krill.auth.required",
  "content": {
    "reason": "TOKEN_INVALID",
    "message": "El teu token no és vàlid. Si us plau, torna a fer pairing.",
    "pairing_url": "krill://pair?agent=@jarvis:matrix.example.com"
  }
}
```

---

## 5. Senses (Permisos)

### 5.1 Concepte

Els "senses" són permisos que l'usuari atorga a l'agent:

| Sense | Descripció |
|-------|------------|
| `calendar` | Accés al calendari |
| `location` | Accés a la ubicació |
| `camera` | Accés a la càmera |
| `contacts` | Accés als contactes |
| `notifications` | Enviar notificacions push |
| `microphone` | Accés al micròfon |
| `photos` | Accés a les fotos |

### 5.2 Actualització de Senses

**Request (App → Agent):**
```json
{
  "type": "ai.krill.senses.update",
  "content": {
    "pairing_token": "krill_tk_v1_...",
    "senses": {
      "calendar": true,
      "location": true,
      "camera": false,
      "notifications": true
    }
  }
}
```

**Response (Agent → App):**
```json
{
  "type": "ai.krill.senses.updated",
  "content": {
    "success": true,
    "senses": {
      "calendar": true,
      "location": true,
      "camera": false,
      "notifications": true
    },
    "message": "Permisos actualitzats correctament."
  }
}
```

### 5.3 Ús dels Senses

L'agent pot demanar dades només si té el sense activat:

```json
{
  "type": "ai.krill.sense.request",
  "content": {
    "sense": "location",
    "reason": "Per donar-te el temps de la teva ubicació actual"
  }
}
```

L'app respon amb les dades o error:

```json
{
  "type": "ai.krill.sense.data",
  "content": {
    "sense": "location",
    "data": {
      "latitude": 25.6866,
      "longitude": -100.3161,
      "accuracy": 10,
      "timestamp": 1706820000
    }
  }
}
```

---

## 6. Revocació de Pairing

### 6.1 Des de l'App

```json
{
  "type": "ai.krill.pair.revoke",
  "content": {
    "pairing_token": "krill_tk_v1_...",
    "reason": "user_requested"
  }
}
```

### 6.2 Resposta

```json
{
  "type": "ai.krill.pair.revoked",
  "content": {
    "success": true,
    "pairing_id": "pair_d525760de7b34757",
    "message": "Pairing revocat correctament. Fins aviat!"
  }
}
```

---

## 7. Errors

### 7.1 Codis d'Error

| Codi | Descripció |
|------|------------|
| `TOKEN_INVALID` | Token no reconegut |
| `TOKEN_EXPIRED` | Token ha expirat |
| `DEVICE_LIMIT_REACHED` | Massa dispositius emparellats |
| `AGENT_NOT_FOUND` | Agent no existeix |
| `AGENT_OFFLINE` | Agent no disponible |
| `SENSE_DENIED` | L'usuari ha denegat el sense |
| `RATE_LIMITED` | Massa peticions |

### 7.2 Event d'Error Genèric

```json
{
  "type": "ai.krill.error",
  "content": {
    "error_code": "RATE_LIMITED",
    "error": "Has fet massa peticions. Espera 60 segons.",
    "retry_after": 60
  }
}
```

---

## 8. Seguretat

### 8.1 Consideracions

1. **Token Secret**: El token mai es transmet en clar fora de Matrix
2. **Hash Storage**: El gateway guarda hash del token, no el token
3. **TLS**: Matrix usa HTTPS (Cloudflare)
4. **E2EE**: Opcionalment, es pot activar xifrat E2E
5. **Nonce**: Cada missatge pot incloure un nonce per evitar replay

### 8.2 Recomanacions per l'App

- Guardar token al Keychain (iOS) o Keystore (Android)
- No loguejar el token
- Implementar certificate pinning per Matrix
- Verificar el sender dels events Krill

---

## 9. Annexos

### 9.1 Exemple Complet de Sessió

```
1. App descobreix agents
   GET #krill-agents state → troba @jarvis

2. App inicia DM
   POST create room with @jarvis

3. App demana pairing
   SEND ai.krill.pair.request

4. Gateway respon
   SEND ai.krill.pair.response + token

5. App guarda token i configura senses
   SEND ai.krill.senses.update

6. Usuari envia missatge
   SEND m.room.message + ai.krill.auth

7. Gateway valida i respon
   Agent processa i respon amb m.room.message

8. [Més tard] Usuari revoca
   SEND ai.krill.pair.revoke
```

### 9.2 Compatibilitat

- Matrix Spec: r0.6.0+
- Synapse: 1.50.0+
- Element: Pot veure events però no els processa
- Altres clients: Ignoren events ai.krill.*
