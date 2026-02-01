# Krill Architecture - Tot via Matrix

## Principi

La Krill App només parla **Matrix protocol**. El gateway (Clawdbot) no és accessible 
directament - tot passa per events Matrix.

```
┌─────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Krill App  │◄───────►│  KrillMatrix    │◄───────►│  Gateway        │
│  (mòbil)    │ Matrix  │  (Synapse)      │  Matrix │  (Clawdbot)     │
│             │ HTTPS   │  Cloudflare     │  local  │                 │
└─────────────┘         └─────────────────┘         └─────────────────┘
      │                        │                           │
      │   Matrix events        │    Matrix events          │
      │   m.room.message       │    (processa)             │
      │   ai.krill.*           │                           │
      └────────────────────────┴───────────────────────────┘
```

---

## 1. Enrollment (Agent Discovery)

**Ja implementat** - State events a la room de registre.

```
Room: #krill-agents:matrix.silverbacking.ai

State Event:
{
  "type": "ai.krill.agent",
  "state_key": "@jarvis:matrix.silverbacking.ai",
  "content": {
    "gateway_id": "jarvis-gateway-001",
    "display_name": "Jarvis",
    "capabilities": ["chat", "senses"],
    "verification_hash": "abc123..."
  }
}
```

**Krill App:**
1. Join la room de registre
2. Llegeix state events `ai.krill.agent`
3. Mostra llista d'agents disponibles

---

## 2. Pairing via Matrix DM

L'app inicia un DM amb l'agent i envia un event de pairing.

### Flow

```
┌─────────────┐                    ┌─────────────────┐
│  Krill App  │                    │  Gateway        │
│             │                    │  (@jarvis)      │
└──────┬──────┘                    └────────┬────────┘
       │                                    │
       │  1. Create DM with @jarvis         │
       │ ─────────────────────────────────► │
       │                                    │
       │  2. Send ai.krill.pair.request     │
       │  {                                 │
       │    device_id: "IPHONE-001",        │
       │    device_name: "iPhone Carles",   │
       │    user_display_name: "Carles"     │
       │  }                                 │
       │ ─────────────────────────────────► │
       │                                    │
       │                                    │  3. Gateway genera token
       │                                    │     Emmagatzema pairing
       │                                    │
       │  4. ai.krill.pair.response         │
       │  {                                 │
       │    success: true,                  │
       │    pairing_token: "krill_tk_...",  │
       │    agent: { name, capabilities }   │
       │  }                                 │
       │ ◄───────────────────────────────── │
       │                                    │
       │  5. App guarda token localment     │
       │                                    │
```

### Event Types

**Request (App → Agent):**
```json
{
  "type": "ai.krill.pair.request",
  "content": {
    "device_id": "IPHONE-001",
    "device_name": "iPhone de Carles",
    "device_type": "ios",
    "app_version": "1.0.0"
  }
}
```

**Response (Agent → App):**
```json
{
  "type": "ai.krill.pair.response",
  "content": {
    "success": true,
    "pairing_id": "pair_abc123",
    "pairing_token": "krill_tk_v1_...",
    "agent": {
      "display_name": "Jarvis",
      "capabilities": ["chat", "senses", "calendar"]
    },
    "message": "Hola! Ara estem connectats. Què puc fer per tu?"
  }
}
```

**Error Response:**
```json
{
  "type": "ai.krill.pair.response",
  "content": {
    "success": false,
    "error": "pairing_limit_reached",
    "message": "Has arribat al límit de dispositius emparellats"
  }
}
```

---

## 3. Comunicació Autenticada

Cada missatge de l'app inclou el token al content.

### Missatge amb Token

```json
{
  "type": "m.room.message",
  "content": {
    "msgtype": "m.text",
    "body": "Quin temps fa avui?",
    "ai.krill.auth": {
      "pairing_token": "krill_tk_v1_..."
    }
  }
}
```

El gateway:
1. Rep el missatge Matrix
2. Extreu `content["ai.krill.auth"]["pairing_token"]`
3. Valida el token contra pairings emmagatzemats
4. Si vàlid → processa el missatge amb l'agent
5. Si invàlid → respon amb error o demana re-pairing

---

## 4. Safe Plugin (Validació)

El plugin intercepta TOTS els missatges entrants i:

1. **Comprova si és un event Krill:**
   - `ai.krill.pair.request` → Processa pairing
   - `m.room.message` amb `ai.krill.auth` → Valida token

2. **Validació del token:**
   ```
   token → hash → cerca pairing → valid?
   ```

3. **Accions segons resultat:**
   - ✅ Token vàlid → Passa missatge a l'agent, actualitza last_seen
   - ❌ Token invàlid → Respon amb `ai.krill.auth.required`
   - ⚠️ Token expirat → Respon amb `ai.krill.pair.expired`

### Event de Re-auth Requerit

```json
{
  "type": "ai.krill.auth.required",
  "content": {
    "reason": "token_invalid",
    "message": "El teu token no és vàlid. Si us plau, torna a fer pairing."
  }
}
```

---

## 5. Senses (Permisos) via Matrix

L'app pot actualitzar permisos enviant un event:

```json
{
  "type": "ai.krill.senses.update",
  "content": {
    "pairing_token": "krill_tk_...",
    "senses": {
      "calendar": true,
      "location": true,
      "camera": false,
      "notifications": true
    }
  }
}
```

Resposta:
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
    }
  }
}
```

---

## 6. Revocació de Pairing

L'usuari pot revocar des de l'app:

```json
{
  "type": "ai.krill.pair.revoke",
  "content": {
    "pairing_token": "krill_tk_..."
  }
}
```

Resposta:
```json
{
  "type": "ai.krill.pair.revoked",
  "content": {
    "success": true,
    "message": "Pairing revocat. Fins aviat!"
  }
}
```

---

## Resum d'Event Types

| Event Type | Direcció | Descripció |
|------------|----------|------------|
| `ai.krill.agent` | State | Agent registrat (enrollment) |
| `ai.krill.pair.request` | App → Agent | Sol·licitud de pairing |
| `ai.krill.pair.response` | Agent → App | Resposta amb token |
| `ai.krill.pair.revoke` | App → Agent | Revoca pairing |
| `ai.krill.pair.revoked` | Agent → App | Confirmació revocació |
| `ai.krill.auth.required` | Agent → App | Token invàlid, cal re-auth |
| `ai.krill.senses.update` | App → Agent | Actualitza permisos |
| `ai.krill.senses.updated` | Agent → App | Confirmació permisos |
| `m.room.message` + `ai.krill.auth` | App → Agent | Missatge autenticat |

---

## Implementació - Plugins Revisats

### krill-enrollment-plugin (sense canvis)
- Publica state events a la room de registre
- No necessita HTTP (només Matrix state events)

### krill-pairing-plugin (revisat)
- Escolta events `ai.krill.pair.*` als DMs
- Genera tokens i respon via Matrix
- Emmagatzema pairings localment

### krill-safe-plugin (nou)
- Intercepta TOTS els missatges entrants
- Valida `ai.krill.auth.pairing_token`
- Bloqueja missatges no autenticats
- Envia `ai.krill.auth.required` si cal
