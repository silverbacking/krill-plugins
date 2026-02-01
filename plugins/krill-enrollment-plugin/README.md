# krill-enrollment-plugin

Plugin per registrar agents d'un OpenClaw gateway al servidor KrillMatrix.

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
