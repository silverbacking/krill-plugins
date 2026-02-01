# Krill Deployment Tiers

## Tiers d'Usuari

### FREE Tier (Self-Hosted)

```
┌─────────────────────────────────────────────────────────────────┐
│  Usuari FREE                                                    │
│                                                                 │
│  1. Descarrega l'instal·lador de krill.silverbacking.ai        │
│                                                                 │
│  2. Opcions de "Krillificació":                                 │
│                                                                 │
│     Opció A: Matrix Local (Docker)                              │
│     ┌─────────────────────────────────────────────────────┐    │
│     │  docker-compose up                                   │    │
│     │  ├── synapse (Matrix server)                         │    │
│     │  ├── clawdbot (Gateway + krill plugins)              │    │
│     │  └── cloudflared (tunnel)                            │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│     Opció B: Krill Cloud Matrix                                 │
│     ┌─────────────────────────────────────────────────────┐    │
│     │  Gateway local connectat a:                          │    │
│     │  → krill-cloud.silverbacking.ai (Matrix compartit)   │    │
│     │                                                       │    │
│     │  Avantatge: No cal córrer Synapse                    │    │
│     │  Limitació: Depèn del nostre servidor                │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  3. L'instal·lador:                                             │
│     ✓ Instal·la/configura Clawdbot                              │
│     ✓ Afegeix krill-enrollment-plugin                           │
│     ✓ Afegeix krill-pairing-plugin                              │
│     ✓ Afegeix krill-safe-plugin                                 │
│     ✓ Genera gateway_secret                                     │
│     ✓ Crea la room de catàleg (si Matrix local)                 │
│     ✓ Registra l'agent a la room                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### PAID Tier (Hosted)

```
┌─────────────────────────────────────────────────────────────────┐
│  Usuari PAID (Pro/Business)                                     │
│                                                                 │
│  1. L'usuari crea agent via dashboard                           │
│                                                                 │
│  2. El sistema automàticament:                                  │
│     ┌─────────────────────────────────────────────────────┐    │
│     │  → Provisiona Gateway (ja "krillificat")             │    │
│     │  → Assigna subdomini (agent-xyz.krill.ai)            │    │
│     │  → Configura Matrix (compartit o dedicat)            │    │
│     │  → Genera credentials                                │    │
│     │  → Crea room de catàleg                              │    │
│     │  → Enrolla l'agent                                   │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  3. L'usuari només ha de configurar l'agent (prompts, etc.)     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Room de Catàleg: Quan es crea?

### Escenaris

#### A) Un servidor Matrix per gateway (self-hosted)
```
Moment: Durant la "krillificació"
Qui la crea: L'instal·lador (script)
Alias: #krill-agents:user-matrix.example.com
```

#### B) Servidor Matrix compartit (krill-cloud)
```
Moment: Quan l'usuari registra el seu gateway
Qui la crea: El backend de Krill
Alias: #krill-agents-{gateway_id}:krill-cloud.silverbacking.ai

Exemple:
  - #krill-agents-gw001:krill-cloud.silverbacking.ai
  - #krill-agents-gw002:krill-cloud.silverbacking.ai
```

#### C) Hosted (PAID)
```
Moment: Durant el provisioning del gateway
Qui la crea: El sistema de provisioning
Alias: #krill-agents:agent-xyz.krill.ai (dedicat) o compartit
```

### Descobriment de Rooms

Com sap Krill App quina room buscar?

**Opció 1: Well-Known**
```
GET https://matrix.example.com/.well-known/krill
{
  "agents_room": "!abc123:matrix.example.com",
  "version": "1.0"
}
```

**Opció 2: Alias Estàndard**
```
L'app sempre busca: #krill-agents:${homeserver}
```

**Opció 3: Room Directory**
```
Cerca a la directory pública per rooms amb topic "krill-agents"
```

---

## Flux de "Krillificació" (FREE)

```bash
# L'usuari executa:
curl -sSL https://krill.silverbacking.ai/install.sh | bash

# L'script:
1. Detecta el sistema (Docker disponible?)
2. Pregunta: Matrix local o Krill Cloud?
3. Si local:
   - docker-compose pull (synapse + clawdbot)
   - Genera secrets
   - Configura Cloudflare tunnel (o alternativa)
   - Inicia containers
4. Si Krill Cloud:
   - Registra gateway al backend
   - Rep credencials Matrix
   - Configura Clawdbot local
5. Instal·la krill-* plugins
6. Crea room de catàleg
7. Enrolla el primer agent
8. Mostra URL per configurar l'agent
```

---

## Components del Instal·lador

```
krill-installer/
├── install.sh              # Entry point
├── docker-compose.yml      # Stack complet (Synapse + Clawdbot)
├── config/
│   ├── synapse/            # Config Synapse
│   └── clawdbot/           # Config Clawdbot amb plugins
├── plugins/
│   ├── krill-enrollment-plugin/
│   ├── krill-pairing-plugin/
│   └── krill-safe-plugin/
└── scripts/
    ├── setup-matrix.sh     # Configura Synapse
    ├── setup-gateway.sh    # Configura Clawdbot
    ├── create-catalog.sh   # Crea room de catàleg
    └── enroll-agent.sh     # Enrolla primer agent
```
