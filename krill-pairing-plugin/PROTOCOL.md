# Krill Pairing Protocol

## Concepte

El pairing és el procés pel qual un usuari (Krill App) s'emparella amb un agent.
El resultat és un **token compartit** que s'utilitza per autenticar cada conversa.

## Regles

1. **Per dispositiu**: Un pairing és específic per usuari + dispositiu
2. **Un token per pairing**: Cada pairing genera un token únic
3. **Renovable**: Es pot fer un nou pairing (el token antic s'invalida)

## Flux de Pairing

```
┌─────────────┐                    ┌─────────────────┐                    ┌─────────────┐
│  Krill App  │                    │  Gateway        │                    │    Agent    │
│  (usuari)   │                    │  (plugin)       │                    │   (Jarvis)  │
└──────┬──────┘                    └────────┬────────┘                    └──────┬──────┘
       │                                    │                                    │
       │  1. POST /krill/pair               │                                    │
       │  {                                 │                                    │
       │    agent_mxid,                     │                                    │
       │    user_mxid,                      │                                    │
       │    device_id,                      │                                    │
       │    device_name                     │                                    │
       │  }                                 │                                    │
       │ ─────────────────────────────────► │                                    │
       │                                    │                                    │
       │                                    │  2. Genera pairing_token           │
       │                                    │     Emmagatzema pairing            │
       │                                    │                                    │
       │                                    │  3. Notifica agent (opcional)      │
       │                                    │ ──────────────────────────────────►│
       │                                    │                                    │
       │  4. Response                       │                                    │
       │  {                                 │                                    │
       │    success: true,                  │                                    │
       │    pairing_token,                  │                                    │
       │    agent: {...}                    │                                    │
       │  }                                 │                                    │
       │ ◄───────────────────────────────── │                                    │
       │                                    │                                    │
       │                                    │                                    │
       │  5. Comunicació amb token          │                                    │
       │ ◄────────────────────────────────────────────────────────────────────►│
       │                                    │                                    │
```

## API

### POST /krill/pair
Inicia un pairing amb un agent.

**Request:**
```json
{
  "agent_mxid": "@jarvis:matrix.silverbacking.ai",
  "user_mxid": "@carles:matrix.silverbacking.ai",
  "device_id": "ABCD1234",
  "device_name": "iPhone de Carles",
  "device_type": "ios"
}
```

**Response (success):**
```json
{
  "success": true,
  "pairing": {
    "pairing_id": "pair_abc123",
    "pairing_token": "krill_tk_...",
    "agent": {
      "mxid": "@jarvis:matrix.silverbacking.ai",
      "display_name": "Jarvis",
      "capabilities": ["chat", "senses"]
    },
    "created_at": 1706817600,
    "expires_at": null
  }
}
```

**Response (error):**
```json
{
  "success": false,
  "error": "Agent not found or not enrolled"
}
```

### GET /krill/pairings
Llista els pairings actius per un agent.

**Response:**
```json
{
  "pairings": [
    {
      "pairing_id": "pair_abc123",
      "user_mxid": "@carles:matrix.silverbacking.ai",
      "device_id": "ABCD1234",
      "device_name": "iPhone de Carles",
      "created_at": 1706817600,
      "last_seen_at": 1706820000
    }
  ]
}
```

### DELETE /krill/pair/{pairing_id}
Revoca un pairing.

**Response:**
```json
{
  "success": true,
  "revoked": "pair_abc123"
}
```

## Estructura del Pairing Token

```
krill_tk_{version}_{random_bytes_base64}
```

Exemple:
```
krill_tk_v1_x7Kj2mNpQ3rS9vWz...
```

El token és opac per l'app - només serveix per autenticar-se.

## Emmagatzematge

Els pairings s'emmagatzemen al gateway:

```json
{
  "pairings": {
    "pair_abc123": {
      "pairing_id": "pair_abc123",
      "pairing_token_hash": "sha256...",
      "agent_mxid": "@jarvis:matrix.silverbacking.ai",
      "user_mxid": "@carles:matrix.silverbacking.ai",
      "device_id": "ABCD1234",
      "device_name": "iPhone de Carles",
      "device_type": "ios",
      "created_at": 1706817600,
      "last_seen_at": 1706820000,
      "senses": {
        "calendar": true,
        "location": false,
        "camera": false
      }
    }
  }
}
```

Nota: Es guarda el **hash** del token, no el token en clar.

## Validació del Token (krill-safe-plugin)

Quan arriba un missatge:

1. Extreu el pairing_token dels headers/metadata
2. Calcula hash del token
3. Cerca pairing amb aquest hash
4. Si existeix i és vàlid → autoritza
5. Actualitza last_seen_at

## Senses (Permisos)

Després del pairing, l'usuari pot configurar "senses":

```
POST /krill/pair/{pairing_id}/senses
{
  "calendar": true,
  "location": true,
  "camera": false,
  "notifications": true
}
```

L'agent només pot accedir als senses autoritzats.
