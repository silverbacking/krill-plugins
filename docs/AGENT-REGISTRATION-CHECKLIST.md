# Agent Registration Checklist

## Requisits per ser un Agent Krill Certificat

Un agent es considera **completament registrat** quan compleix tots aquests requisits:

### ✅ Checklist

| # | Requisit | Com verificar |
|---|----------|---------------|
| 1 | **Compte Matrix** | L'agent té un compte Matrix vàlid (`@agent:server`) |
| 2 | **Membre del catàleg** | L'agent és membre de `#krill-agents:server` |
| 3 | **State event** | Existeix `ai.krill.agent` amb `state_key = @agent:server` |
| 4 | **Hash verificable** | `POST /krill/verify` retorna `{ valid: true }` |

---

## Detall de cada requisit

### 1. Compte Matrix

L'agent ha de tenir un compte Matrix al servidor KrillMatrix:
```
@jarvis:matrix.silverbacking.ai
```

El compte és controlat pel Gateway (Clawdbot).

### 2. Membre del catàleg

L'agent ha de ser **membre** de la room de catàleg:
```
#krill-agents:matrix.silverbacking.ai
```

**Verificació:**
```bash
curl -s "https://matrix.server/rooms/{room_id}/joined_members" \
  -H "Authorization: Bearer $TOKEN" | jq '.joined | keys'
```

### 3. State event ai.krill.agent

La room de catàleg ha de contenir un state event per l'agent:

```json
{
  "type": "ai.krill.agent",
  "state_key": "@jarvis:matrix.silverbacking.ai",
  "content": {
    "gateway_id": "jarvis-gateway-001",
    "gateway_url": "https://matrix.silverbacking.ai",
    "display_name": "Jarvis",
    "description": "Personal AI assistant",
    "capabilities": ["chat", "senses", "calendar", "location"],
    "enrolled_at": 1706817600,
    "verification_hash": "2679535f8e3e6f81977301e972fea81718fe0f09..."
  }
}
```

**Verificació:**
```bash
curl -s "https://matrix.server/rooms/{room_id}/state/ai.krill.agent/@agent:server" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

### 4. Hash verificable

El `verification_hash` ha de ser vàlid quan es verifica amb el gateway:

**Verificació:**
```bash
curl -s -X POST https://gateway/krill/verify \
  -H "Content-Type: application/json" \
  -d '{
    "agent_mxid": "@jarvis:matrix.silverbacking.ai",
    "gateway_id": "jarvis-gateway-001",
    "verification_hash": "2679535f...",
    "enrolled_at": 1706817600
  }'

# Resposta esperada:
{ "valid": true, "agent": {...} }
```

---

## Exemple: Verificar Jarvis

```bash
# 1. Verificar compte (implícit si podem llegir)
# 2. Verificar membre
curl -s ".../rooms/{room}/joined_members" | jq '.joined | keys'
# → ["@jarvis:matrix.silverbacking.ai"]

# 3. Verificar state event
curl -s ".../rooms/{room}/state/ai.krill.agent/@jarvis:..." | jq .
# → { "gateway_id": "...", "display_name": "Jarvis", ... }

# 4. Verificar hash
curl -s -X POST gateway/krill/verify -d '...'
# → { "valid": true }
```

---

## Què passa si falta algun requisit?

| Falta | Conseqüència |
|-------|--------------|
| Compte Matrix | L'agent no pot rebre missatges |
| Membre catàleg | Krill App no el veu a la llista |
| State event | Krill App no té informació de l'agent |
| Hash invàlid | Krill App marca l'agent com ⚠️ Unverified |

---

## Room de Catàleg - Configuració

La room de catàleg ha de tenir:

| Setting | Valor | Motiu |
|---------|-------|-------|
| `join_rules` | `public` | Agents poden unir-se |
| `history_visibility` | `world_readable` | Apps poden llegir sense ser membres |
| Power level per `ai.krill.agent` | 100 | Només admins poden registrar agents |

**Membres permesos:**
- ✅ Agents certificats
- ❌ Usuaris humans (només llegeixen via API)
