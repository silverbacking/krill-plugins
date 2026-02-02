# Krill Agent Verification Protocol

## Objectiu

Permetre que Krill App verifiqui que un agent és real i actiu **sense necessitat de connectar-se al gateway directament**. Tot passa via Matrix.

## Principi

```
L'app envia un CHALLENGE → L'agent respon → L'app confia
```

La verificació es basa en que:
1. Només el gateway real controla el compte Matrix de l'agent
2. Matrix garanteix la identitat del sender
3. Si l'agent respon correctament, és legítim

---

## Flux de Verificació

```
┌─────────────┐                    ┌─────────────────┐
│  Krill App  │                    │  Agent          │
│             │                    │  (Gateway)      │
└──────┬──────┘                    └────────┬────────┘
       │                                    │
       │  1. ai.krill.verify.request        │
       │  {                                 │
       │    challenge: "uuid-random",       │
       │    timestamp: 1706820000           │
       │  }                                 │
       │ ─────────────────────────────────► │
       │                                    │
       │     2. Gateway processa:           │
       │        - Valida timestamp (< 60s)  │
       │        - Prepara resposta          │
       │                                    │
       │  3. ai.krill.verify.response       │
       │  {                                 │
       │    challenge: "uuid-random",       │
       │    verified: true,                 │
       │    agent: {                        │
       │      mxid, display_name,           │
       │      gateway_id, capabilities      │
       │    }                               │
       │  }                                 │
       │ ◄───────────────────────────────── │
       │                                    │
       │  4. App verifica:                  │
       │     ✓ Challenge coincideix         │
       │     ✓ Resposta < 30 segons         │
       │     ✓ Sender és l'agent esperat    │
       │                                    │
       │  5. ✅ Agent verificat!            │
       │                                    │
```

---

## Event Types

### ai.krill.verify.request

Enviat per Krill App a l'agent (via DM).

```json
{
  "type": "ai.krill.verify.request",
  "content": {
    "challenge": "550e8400-e29b-41d4-a716-446655440000",
    "timestamp": 1706820000,
    "app_version": "1.0.0"
  }
}
```

| Camp | Tipus | Descripció |
|------|-------|------------|
| `challenge` | string | UUID únic generat per l'app |
| `timestamp` | number | Unix timestamp (segons) |
| `app_version` | string | Versió de l'app (opcional) |

### ai.krill.verify.response

Respost pel gateway.

**Success:**
```json
{
  "type": "ai.krill.verify.response",
  "content": {
    "challenge": "550e8400-e29b-41d4-a716-446655440000",
    "verified": true,
    "agent": {
      "mxid": "@jarvis:matrix.silverbacking.ai",
      "display_name": "Jarvis",
      "gateway_id": "jarvis-gateway-001",
      "capabilities": ["chat", "senses", "calendar", "location"],
      "status": "online"
    },
    "responded_at": 1706820002
  }
}
```

**Error:**
```json
{
  "type": "ai.krill.verify.response",
  "content": {
    "challenge": "550e8400-e29b-41d4-a716-446655440000",
    "verified": false,
    "error": "CHALLENGE_EXPIRED",
    "message": "El challenge ha expirat (> 60 segons)"
  }
}
```

---

## Validacions

### L'App valida:

| Validació | Acció si falla |
|-----------|----------------|
| Challenge coincideix | Rebutjar (possible replay) |
| Resposta < 30s | Timeout, reintentar |
| Sender = agent esperat | Rebutjar (impostor) |
| `verified: true` | Mostrar error |

### El Gateway valida:

| Validació | Acció si falla |
|-----------|----------------|
| Timestamp < 60s | Respondre amb error CHALLENGE_EXPIRED |
| Event type correcte | Ignorar |

---

## Seguretat

### Per què és segur?

1. **Identitat garantida per Matrix**
   - El sender de la resposta és verificat per Matrix
   - Ningú pot enviar missatges com `@jarvis:server` sense controlar el compte

2. **Challenge únic**
   - L'app genera un UUID nou cada cop
   - Prevé replay attacks

3. **Timestamp**
   - Challenges antics són rebutjats
   - Finestra de 60 segons

4. **No es comparteix cap secret**
   - El `gateway_secret` mai surt del gateway
   - La verificació es basa en identitat Matrix, no en criptografia

### Possibles atacs i mitigacions

| Atac | Mitigació |
|------|-----------|
| Replay de resposta | Challenge únic per request |
| Impostor | Matrix verifica sender |
| Challenge antic | Timestamp amb finestra 60s |
| DoS (molts requests) | Rate limiting al gateway |

---

## Quan fer verificació?

| Moment | Recomanat |
|--------|-----------|
| Primer cop que veus l'agent | ✅ Sí |
| Abans de fer pairing | ✅ Sí |
| Cada cop que obres l'app | ❌ No (innecessari) |
| Periòdicament (cada hora) | 🤔 Opcional |

---

## Implementació Actual

### Format del Missatge

Krill App envia un missatge normal (`m.room.message`) amb format JSON:

```json
{
  "msgtype": "m.text",
  "body": "{\"type\":\"ai.krill.verify.request\",\"content\":{\"challenge\":\"uuid-abc\",\"timestamp\":1706820000}}"
}
```

O format simplificat:
```
KRILL_VERIFY:uuid-challenge:timestamp
```

### Processament al Gateway

El plugin detecta missatges amb aquest format i genera la resposta automàticament.

**Nota:** Per a una integració completa, caldria modificar Clawdbot core per interceptar 
aquests missatges abans que arribin a l'agent. Per ara, l'agent (Claude) és conscient 
d'aquest patró i respon correctament.

---

## Integració amb el flux de l'app

```
1. App llegeix catàleg (#krill-agents)
   └── Troba @jarvis amb capabilities

2. Usuari selecciona Jarvis per pairing
   └── App envia ai.krill.verify.request

3. Agent respon amb ai.krill.verify.response
   └── App valida resposta

4. Si verificat:
   └── App mostra botó "Pair"
   └── Usuari pot iniciar pairing

5. Si NO verificat:
   └── App mostra ⚠️ "Agent no respon"
   └── Usuari no pot fer pairing
```

---

## Exemples

### Request
```json
{
  "type": "ai.krill.verify.request",
  "content": {
    "challenge": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": 1706820000
  }
}
```

### Response (èxit)
```json
{
  "type": "ai.krill.verify.response",
  "content": {
    "challenge": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "verified": true,
    "agent": {
      "mxid": "@jarvis:matrix.silverbacking.ai",
      "display_name": "Jarvis",
      "gateway_id": "jarvis-gateway-001",
      "capabilities": ["chat", "senses", "calendar", "location"],
      "status": "online"
    },
    "responded_at": 1706820002
  }
}
```

### Response (error)
```json
{
  "type": "ai.krill.verify.response",
  "content": {
    "challenge": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "verified": false,
    "error": "CHALLENGE_EXPIRED"
  }
}
```
