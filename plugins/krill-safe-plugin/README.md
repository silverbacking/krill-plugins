# krill-safe-plugin

Plugin que intercepta missatges Matrix i valida autenticació Krill.

## Funció

1. **Intercepta** tots els missatges entrants al canal Matrix
2. **Processa** events Krill (`ai.krill.pair.*`, etc.)
3. **Valida** tokens en missatges normals (`ai.krill.auth`)
4. **Bloqueja** missatges no autenticats (si requerit)

## Events Processats

| Event | Acció |
|-------|-------|
| `ai.krill.pair.request` | Crea pairing, respon amb token |
| `ai.krill.pair.revoke` | Revoca pairing |
| `ai.krill.senses.update` | Actualitza permisos |
| `m.room.message` + `ai.krill.auth` | Valida token, passa a l'agent |

## Configuració

```yaml
plugins:
  entries:
    krill-safe:
      enabled: true
      config:
        requireAuth: true  # Bloqueja missatges sense token
        allowedWithoutAuth:
          - "@carles:matrix.silverbacking.ai"  # Owners bypassen auth
```

## Integració amb Matrix Channel

El plugin s'integra amb el canal Matrix de Clawdbot per interceptar
missatges abans que arribin a l'agent.
