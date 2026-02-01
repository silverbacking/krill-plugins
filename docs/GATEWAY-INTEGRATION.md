# Gateway Integration - Com funciona /krill/verify

## El Problema

Krill App necessita verificar agents amb el gateway:
```
POST https://gateway.example.com/krill/verify
```

Però Clawdbot (OpenClaw gateway) no exposa endpoints HTTP per defecte.
Com afegim aquesta funcionalitat?

---

## Opcions d'Implementació

### Opció A: Plugin HTTP per Clawdbot

Un plugin que afegeix endpoints al gateway existent.

```
┌─────────────────────────────────────────────────┐
│  Clawdbot Gateway                               │
├─────────────────────────────────────────────────┤
│  Core (Claude, sessions, etc.)                  │
│  ├── Channel: Matrix                            │
│  ├── Channel: Telegram                          │
│  └── Plugin: krill-enrollment  ◄── NOU          │
│        └── HTTP endpoints                       │
│            ├── POST /krill/verify               │
│            ├── POST /krill/enroll               │
│            └── GET /krill/agents                │
└─────────────────────────────────────────────────┘
```

**Pros:** Tot integrat, accés directe a config i agents
**Contres:** Depèn de l'arquitectura de plugins de Clawdbot

---

### Opció B: Sidecar Service

Un servei separat que corre al costat del gateway.

```
┌───────────────────┐     ┌───────────────────┐
│  Clawdbot Gateway │     │  Krill Sidecar    │
│  (port 3000)      │     │  (port 3001)      │
├───────────────────┤     ├───────────────────┤
│  Core             │◄───►│  /krill/verify    │
│  Channels         │     │  /krill/enroll    │
│                   │     │  /krill/agents    │
└───────────────────┘     └───────────────────┘
         │                         │
         └────────┬────────────────┘
                  ▼
         Shared config/secrets
```

**Pros:** Independent, fàcil de desplegar
**Contres:** Més complexitat, necessita accés a config

---

### Opció C: Clawdbot Native Extension

Afegir suport natiu a Clawdbot per endpoints HTTP custom.

```yaml
# config.yaml
extensions:
  krill:
    enabled: true
    secret: "gateway-secret-key"
    endpoints:
      - path: /krill/verify
        handler: krill-verify
      - path: /krill/enroll
        handler: krill-enroll
```

**Pros:** El més net, part del core
**Contres:** Requereix canvis a Clawdbot upstream

---

## Recomanació: Opció B (Sidecar)

Per ara, un **sidecar service** és el més pràctic:

1. **Independent**: No cal modificar Clawdbot
2. **Simple**: Un script Node.js/Python amb Express/FastAPI
3. **Ràpid**: Podem tenir-ho funcionant avui

### Arquitectura Sidecar

```
┌─────────────────────────────────────────────────────────────────┐
│  Host (gateway.silverbacking.ai)                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────┐    ┌─────────────────────┐            │
│  │  Clawdbot Gateway   │    │  Krill Sidecar      │            │
│  │                     │    │                     │            │
│  │  - Claude API       │    │  - /krill/verify    │            │
│  │  - Matrix channel   │    │  - /krill/enroll    │            │
│  │  - Telegram channel │    │  - /krill/agents    │            │
│  │                     │    │                     │            │
│  │  Internal: 3000     │    │  Internal: 3001     │            │
│  └─────────────────────┘    └─────────────────────┘            │
│           │                          │                          │
│           └──────────┬───────────────┘                          │
│                      ▼                                          │
│              ┌───────────────┐                                  │
│              │  Nginx/Caddy  │                                  │
│              │  Reverse Proxy│                                  │
│              │  :443 (HTTPS) │                                  │
│              └───────────────┘                                  │
│                      │                                          │
└──────────────────────┼──────────────────────────────────────────┘
                       ▼
                   Internet
                       
    /krill/*  → Sidecar (3001)
    /*        → Clawdbot (3000)  [si cal]
```

### Shared Config

El sidecar llegeix la mateixa config que Clawdbot:

```yaml
# krill-sidecar.yaml
gateway_id: "clawdbot-001"
gateway_secret: "super-secret-key"  # Per generar/verificar hashos
matrix:
  homeserver: "https://matrix.silverbacking.ai"
  access_token: "syt_..."
agents:
  - mxid: "@jarvis:matrix.silverbacking.ai"
    display_name: "Jarvis"
    capabilities: ["chat", "senses"]
```

---

## Implementació del Sidecar

### POST /krill/verify

```javascript
app.post('/krill/verify', (req, res) => {
  const { agent_mxid, gateway_id, verification_hash, enrolled_at } = req.body;
  
  // Recalcular hash
  const message = `${agent_mxid}|${gateway_id}|${enrolled_at}`;
  const expected = crypto
    .createHmac('sha256', GATEWAY_SECRET)
    .update(message)
    .digest('hex');
  
  if (verification_hash === expected) {
    // Opcional: comprovar que l'agent existeix a la config
    const agent = agents.find(a => a.mxid === agent_mxid);
    res.json({
      valid: true,
      agent: agent ? {
        mxid: agent.mxid,
        display_name: agent.display_name,
        status: 'online'
      } : null
    });
  } else {
    res.json({ valid: false, error: 'Hash mismatch' });
  }
});
```

### POST /krill/enroll

```javascript
app.post('/krill/enroll', async (req, res) => {
  const { agent_mxid, display_name, capabilities } = req.body;
  
  // Generar hash
  const enrolled_at = Math.floor(Date.now() / 1000);
  const message = `${agent_mxid}|${GATEWAY_ID}|${enrolled_at}`;
  const verification_hash = crypto
    .createHmac('sha256', GATEWAY_SECRET)
    .update(message)
    .digest('hex');
  
  // Publicar state event a Matrix
  await matrixClient.sendStateEvent(
    AGENTS_ROOM_ID,
    'ai.krill.agent',
    agent_mxid,
    {
      gateway_id: GATEWAY_ID,
      gateway_url: GATEWAY_URL,
      display_name,
      capabilities,
      enrolled_at,
      verification_hash
    }
  );
  
  res.json({ success: true, enrolled_at, verification_hash });
});
```

---

## Futur: Plugin Natiu

Quan Clawdbot suporti extensions HTTP natives, migrem el sidecar a un plugin integrat. Per ara, el sidecar funciona perfectament.
