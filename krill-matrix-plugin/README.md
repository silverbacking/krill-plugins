# krill-matrix-plugin

Fork de `@clawdbot/matrix` amb suport natiu per al protocol Krill.

## Què fa?

Intercepta missatges del protocol Krill **abans** que arribin a l'agent IA:

```
Missatge Matrix arriba
        │
        ▼
┌─────────────────┐
│ És ai.krill.* ? │
└────────┬────────┘
    SÍ   │   NO
    ▼    │    ▼
┌────────┴───────┐  ┌──────────────────┐
│ KRILL HANDLER  │  │ Agent IA (Claude)│
│ (determinístic)│  │ (normal flow)    │
└────────────────┘  └──────────────────┘
```

## Avantatge

- ✅ Comportament 100% determinístic per protocol Krill
- ✅ No depèn del comportament de l'LLM
- ✅ Respostes instantànies per verify/pair
- ✅ Zero risc d'errors d'interpretació

## Events Interceptats

| Event | Acció |
|-------|-------|
| `ai.krill.verify.request` | Respon amb verify.response |
| `ai.krill.pair.request` | Genera token, guarda pairing |
| `ai.krill.pair.revoke` | Elimina pairing |
| `ai.krill.senses.update` | Actualitza permisos |

## Instal·lació

```bash
# Substitueix el plugin matrix original
clawdbot plugins disable matrix
clawdbot plugins install -l ./krill-matrix-plugin
```

## Configuració

```yaml
plugins:
  entries:
    krill-matrix:
      enabled: true
      config:
        gatewayId: "my-gateway-001"
        gatewaySecret: "super-secret-key"
        agents:
          - mxid: "@jarvis:matrix.silverbacking.ai"
            displayName: "Jarvis"
            capabilities: ["chat", "senses", "calendar"]

channels:
  matrix:
    enabled: true
    # ... resta de config Matrix normal ...
```

## Basat en

Fork de `@clawdbot/matrix` v2026.1.24
