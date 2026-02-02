# krill-enrollment-plugin

Plugin de Clawdbot per registrar agents d'un OpenClaw gateway al servidor KrillMatrix.

## Instal·lació

```bash
clawdbot plugins install -l ./plugins/krill-enrollment-plugin
```

## Configuració

```yaml
plugins:
  entries:
    krill-enrollment:
      enabled: true
      config:
        gatewayId: "clawdbot-001"
        gatewaySecret: "your-super-secret-key"
        gatewayUrl: "https://gateway.silverbacking.ai"
        agentsRoomId: "!abc123:matrix.silverbacking.ai"
        agents:
          - mxid: "@jarvis:matrix.silverbacking.ai"
            displayName: "Jarvis"
            description: "Personal AI assistant"
            capabilities: ["chat", "senses", "calendar"]
```

## Endpoints HTTP

| Endpoint | Mètode | Descripció |
|----------|--------|------------|
| `/krill/verify` | POST | Verifica un hash d'agent |
| `/krill/enroll` | POST | Genera enrollment data per un agent |
| `/krill/agents` | GET | Llista tots els agents configurats |

## CLI

```bash
# Generar state event per un agent
clawdbot krill enroll @jarvis:matrix.silverbacking.ai --name "Jarvis"

# Veure estat del plugin
clawdbot krill status
```

## Verificació via Matrix

El plugin també gestiona verificacions via Matrix (sense HTTP).

### Event Types

**Request (App → Agent):**
```json
{
  "type": "ai.krill.verify.request",
  "content": {
    "challenge": "uuid-random",
    "timestamp": 1706820000
  }
}
```

**Response (Agent → App):**
```json
{
  "type": "ai.krill.verify.response",
  "content": {
    "challenge": "uuid-random",
    "verified": true,
    "agent": {
      "mxid": "@jarvis:matrix...",
      "display_name": "Jarvis",
      "capabilities": ["chat", "senses"]
    }
  }
}
```

### Flux

1. Krill App envia `ai.krill.verify.request` per DM a l'agent
2. Gateway detecta l'event i processa
3. Gateway respon amb `ai.krill.verify.response`
4. App valida que el challenge coincideix

Veure `docs/VERIFICATION-PROTOCOL.md` per més detalls.

## Funció

Permet que un gateway (Clawdbot, OpenClaw) marqui els seus agents com a reconeguts per Krill. 
Els agents marcats són descoberts automàticament pels usuaris de Krill App.

## Flux

1. **Gateway auth**: El gateway s'autentica amb el servidor Matrix (credencials o token)
2. **Enrollment request**: El gateway envia una petició per registrar un agent
3. **Agent marking**: El servidor afegeix atributs verificables a l'agent
4. **Confirmation**: El gateway rep confirmació + certificat

## Agent Marking (Matrix)

Els agents es marquen mitjançant un **custom state event** a la room de control:

```json
{
  "type": "ai.krill.agent",
  "state_key": "@jarvis:matrix.silverbacking.ai",
  "content": {
    "gateway_id": "clawdbot-gateway-001",
    "enrolled_at": "2026-02-01T17:00:00Z",
    "display_name": "Jarvis",
    "description": "Personal AI assistant",
    "capabilities": ["chat", "senses"],
    "signature": "base64-server-signature..."
  }
}
```

La **signature** és generada pel servidor i només ell pot crear-la → no falsificable.

## API

### POST /krill/enroll
```json
{
  "agent_mxid": "@jarvis:matrix.silverbacking.ai",
  "gateway_id": "clawdbot-gateway-001", 
  "display_name": "Jarvis",
  "description": "Personal AI assistant",
  "capabilities": ["chat", "senses"]
}
```

### Response
```json
{
  "success": true,
  "agent_mxid": "@jarvis:matrix.silverbacking.ai",
  "certificate": "base64-certificate...",
  "enrolled_at": "2026-02-01T17:00:00Z"
}
```

## Implementació

El plugin pot funcionar de dues maneres:

### Opció A: Synapse Module
Un mòdul de Synapse que exposa l'API `/krill/enroll` i gestiona el marking.

### Opció B: Application Service
Un appservice que escolta events i gestiona enrollments via messages.

## Primer cas d'ús

Marcar `@jarvis:matrix.silverbacking.ai` com a agent Krill al servidor matrix.silverbacking.ai.
