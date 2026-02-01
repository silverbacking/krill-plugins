# Krill Enrollment Protocol

## Concepte

La **Room de Registre** actua com a catàleg públic d'agents certificats per un gateway.
Cada gateway té la seva room de registre on publica els seus agents.

## Verificació amb Hash

Cada agent registrat inclou un `verification_hash` que permet a Krill App verificar 
l'autenticitat de l'agent contactant directament el gateway.

### Generació del Hash (Gateway)

```
verification_hash = HMAC-SHA256(
    key = gateway_secret,
    message = agent_mxid + "|" + gateway_id + "|" + enrolled_timestamp
)
```

Exemple:
```
gateway_secret = "super-secret-key-del-gateway"
message = "@jarvis:matrix.silverbacking.ai|clawdbot-001|1706817600"
verification_hash = "a3f2b1c4d5e6..."
```

### State Event Complet

```json
{
  "type": "ai.krill.agent",
  "state_key": "@jarvis:matrix.silverbacking.ai",
  "content": {
    "gateway_id": "clawdbot-001",
    "gateway_url": "https://gateway.silverbacking.ai",
    "display_name": "Jarvis",
    "description": "Personal AI assistant",
    "avatar_url": "mxc://matrix.silverbacking.ai/abc123",
    "capabilities": ["chat", "senses", "calendar", "location"],
    "enrolled_at": 1706817600,
    "verification_hash": "a3f2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2"
  }
}
```

## Flux de Verificació (Krill App → Gateway)

```
┌─────────────┐                    ┌─────────────────┐
│  Krill App  │                    │  OpenClaw       │
│             │                    │  Gateway        │
└──────┬──────┘                    └────────┬────────┘
       │                                    │
       │  1. Llegeix catàleg (room state)   │
       │     → troba @jarvis amb hash       │
       │                                    │
       │  2. POST /krill/verify             │
       │  {                                 │
       │    "agent_mxid": "@jarvis:...",    │
       │    "verification_hash": "a3f2..."  │
       │  }                                 │
       │ ─────────────────────────────────► │
       │                                    │
       │  3. Gateway verifica:              │
       │     hash == HMAC(secret, data)?    │
       │                                    │
       │  4. Response                       │
       │  { "valid": true, "agent": {...} } │
       │ ◄───────────────────────────────── │
       │                                    │
```

### Gateway Verification Endpoint

**POST /krill/verify**
```json
{
  "agent_mxid": "@jarvis:matrix.silverbacking.ai",
  "verification_hash": "a3f2b1c4d5e6...",
  "gateway_id": "clawdbot-001"
}
```

**Response (valid)**
```json
{
  "valid": true,
  "agent": {
    "mxid": "@jarvis:matrix.silverbacking.ai",
    "display_name": "Jarvis",
    "capabilities": ["chat", "senses"],
    "status": "online"
  }
}
```

**Response (invalid)**
```json
{
  "valid": false,
  "error": "Hash mismatch or agent not registered"
}
```

## Seguretat

### Per què és segur?

1. **Hash no falsificable**: Només el gateway coneix el `gateway_secret`
2. **Verificació en temps real**: Krill App pot confirmar amb el gateway
3. **Timestamp inclòs**: Evita replay attacks (hash canvia si es re-enrolla)
4. **Gateway URL verificable**: L'app connecta directament al gateway

### Què passa si algú copia l'event?

- Pot copiar l'event a una altra room ✓
- Però NO pot passar la verificació amb el gateway ✗
- El gateway només confirma agents que realment controla

## Room de Registre - Configuració

### Creació
```
Room alias: #krill-agents-{gateway_id}:matrix.silverbacking.ai
Exemple: #krill-agents-clawdbot-001:matrix.silverbacking.ai
```

### Permisos
- **Admin**: Compte del gateway (pot enviar state events)
- **Membres**: Qualsevol pot unir-se i llegir (públic)
- **Events**: Només admin pot enviar `ai.krill.agent`

### Power Levels
```json
{
  "events": {
    "ai.krill.agent": 100
  },
  "users": {
    "@clawdbot:matrix.silverbacking.ai": 100
  }
}
```

## Enrollment Flow Complet

```
┌─────────────┐         ┌─────────────────┐         ┌─────────────┐
│  OpenClaw   │         │    Matrix       │         │  Krill App  │
│  Gateway    │         │    Server       │         │             │
└──────┬──────┘         └────────┬────────┘         └──────┬──────┘
       │                         │                         │
       │  1. Create room         │                         │
       │     #krill-agents-xxx   │                         │
       │ ──────────────────────► │                         │
       │                         │                         │
       │  2. Set power levels    │                         │
       │ ──────────────────────► │                         │
       │                         │                         │
       │  3. PUT state event     │                         │
       │     ai.krill.agent      │                         │
       │     + verification_hash │                         │
       │ ──────────────────────► │                         │
       │                         │                         │
       │                         │  4. User joins room     │
       │                         │ ◄────────────────────── │
       │                         │                         │
       │                         │  5. GET room state      │
       │                         │ ◄────────────────────── │
       │                         │                         │
       │                         │  6. State events        │
       │                         │ ──────────────────────► │
       │                         │                         │
       │  7. POST /krill/verify                            │
       │ ◄──────────────────────────────────────────────── │
       │                                                   │
       │  8. { valid: true }                               │
       │ ────────────────────────────────────────────────► │
       │                         │                         │
```

## Implementació - Components Necessaris

### 1. Gateway (Clawdbot) - Plugin/Extensió
- Crear room de registre
- Publicar state events per cada agent
- Endpoint `/krill/verify` per validar hashos
- Gestió del `gateway_secret`

### 2. Krill App - Client
- Descobrir rooms de registre (per alias pattern o directori)
- Llegir state events `ai.krill.agent`
- Verificar agents amb el gateway
- Mostrar catàleg d'agents disponibles

### 3. (Opcional) Directori Central
- Llista de gateways coneguts i les seves rooms
- Per fase 2 (federació)
