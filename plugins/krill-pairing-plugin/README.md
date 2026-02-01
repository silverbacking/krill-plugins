# krill-pairing-plugin

Plugin de Clawdbot per gestionar pairings entre usuaris i agents.

## Instal·lació

```bash
clawdbot plugins install -l ./plugins/krill-pairing-plugin
```

## Configuració

```yaml
plugins:
  entries:
    krill-pairing:
      enabled: true
      config:
        storagePath: "~/.clawdbot/krill/pairings.json"
        tokenExpiry: 0  # 0 = never expires
```

## Endpoints HTTP

| Endpoint | Mètode | Descripció |
|----------|--------|------------|
| `/krill/pair` | POST | Crea un nou pairing |
| `/krill/pairings` | GET | Llista pairings actius |
| `/krill/validate` | POST | Valida un pairing token |
| `/krill/pair/{id}` | DELETE | Revoca un pairing |
| `/krill/pair/{id}/senses` | POST | Actualitza senses/permisos |

## Flux de Pairing

```
Krill App                          Gateway
    │                                  │
    │  POST /krill/pair                │
    │  { agent_mxid, user_mxid,        │
    │    device_id, device_name }      │
    │ ───────────────────────────────► │
    │                                  │
    │  { success: true,                │
    │    pairing_token: "krill_tk_..." │
    │  }                               │
    │ ◄─────────────────────────────── │
    │                                  │
    │  [Guarda token localment]        │
    │                                  │
```

## CLI

```bash
# Llistar pairings
clawdbot krill-pair list

# Revocar pairing
clawdbot krill-pair revoke <pairing_id>
```

## Token Format

```
krill_tk_v1_{32_random_bytes_base64url}
```

El token es retorna només un cop (durant el pairing). Es guarda el hash, no el token.
