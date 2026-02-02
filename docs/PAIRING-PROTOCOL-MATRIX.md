# Krill Pairing Protocol (via Matrix)

## Principi

Tot el pairing passa via **missatges Matrix**. No hi ha endpoints HTTP exposats.

## Flux de Pairing

```
┌─────────────┐                    ┌─────────────────┐
│  Krill App  │                    │  Agent          │
│             │                    │  (Gateway)      │
└──────┬──────┘                    └────────┬────────┘
       │                                    │
       │  1. Crear DM amb @agent            │
       │ ─────────────────────────────────► │
       │                                    │
       │  2. ai.krill.pair.request          │
       │ ─────────────────────────────────► │
       │                                    │
       │     3. Gateway genera token        │
       │        Emmagatzema pairing         │
       │                                    │
       │  4. ai.krill.pair.response         │
       │ ◄───────────────────────────────── │
       │                                    │
       │  5. App guarda token localment     │
       │                                    │
```

## Event Types

### ai.krill.pair.request

Enviat per Krill App (com a missatge m.room.message):

```json
{
  "type": "ai.krill.pair.request",
  "content": {
    "device_id": "IPHONE-ABC123",
    "device_name": "iPhone de Carles",
    "device_type": "ios",
    "app_version": "1.0.0",
    "timestamp": 1706820000
  }
}
```

**Format del missatge Matrix:**
```json
{
  "msgtype": "m.text",
  "body": "{\"type\":\"ai.krill.pair.request\",\"content\":{...}}"
}
```

### ai.krill.pair.response

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
      "mxid": "@jarvis:matrix.silverbacking.ai",
      "display_name": "Jarvis",
      "capabilities": ["chat", "senses", "calendar", "location"]
    },
    "created_at": 1706820000,
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
    "error": "DEVICE_LIMIT_REACHED",
    "message": "Has arribat al límit de dispositius emparellats"
  }
}
```

## Altres Events de Pairing

### ai.krill.pair.revoke

Per revocar un pairing:

```json
{
  "type": "ai.krill.pair.revoke",
  "content": {
    "pairing_token": "krill_tk_v1_..."
  }
}
```

**Resposta:**
```json
{
  "type": "ai.krill.pair.revoked",
  "content": {
    "success": true,
    "message": "Pairing revocat. Fins aviat!"
  }
}
```

### ai.krill.senses.update

Per actualitzar permisos:

```json
{
  "type": "ai.krill.senses.update",
  "content": {
    "pairing_token": "krill_tk_v1_...",
    "senses": {
      "calendar": true,
      "location": true,
      "camera": false
    }
  }
}
```

**Resposta:**
```json
{
  "type": "ai.krill.senses.updated",
  "content": {
    "success": true,
    "senses": {
      "calendar": true,
      "location": true,
      "camera": false
    }
  }
}
```

## Comunicació Autenticada Post-Pairing

Després del pairing, cada missatge de l'app inclou el token:

```json
{
  "msgtype": "m.text",
  "body": "Quin temps fa?",
  "ai.krill.auth": {
    "pairing_token": "krill_tk_v1_..."
  }
}
```

El gateway extreu el token, el valida, i processa el missatge.

## Seguretat

### Token Generation
```typescript
const token = `krill_tk_v1_${crypto.randomBytes(32).toString('base64url')}`;
```

### Token Storage
El gateway guarda el **hash** del token, no el token:
```typescript
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
```

### Per què és segur via Matrix?
1. Matrix garanteix la identitat del sender
2. El token es transmet via canal segur (TLS)
3. El token només es retorna UN COP (durant pairing)
4. Després, es valida via hash

## Implementació

El gateway (Clawdbot) processa aquests events quan els rep:

1. Detecta format `ai.krill.pair.*`
2. Processa segons el tipus
3. Respon amb el format corresponent

Com que Clawdbot no intercepta automàticament custom events, 
l'agent (Claude) és conscient d'aquest protocol i respon correctament.

## Resum d'Events

| Event | Direcció | Descripció |
|-------|----------|------------|
| `ai.krill.pair.request` | App → Agent | Sol·licitud de pairing |
| `ai.krill.pair.response` | Agent → App | Resposta amb token |
| `ai.krill.pair.revoke` | App → Agent | Revoca pairing |
| `ai.krill.pair.revoked` | Agent → App | Confirmació revocació |
| `ai.krill.senses.update` | App → Agent | Actualitza permisos |
| `ai.krill.senses.updated` | Agent → App | Confirmació permisos |
