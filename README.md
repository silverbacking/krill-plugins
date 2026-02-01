# Krill Plugins

Monorepo for Krill channel plugins - secure human-agent communication over Matrix.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design.

## Plugins

| Plugin | Description | Status |
|--------|-------------|--------|
| `krill-enrollment-plugin` | Gateway registers agents with server (marking) | 🚧 In Progress |
| `krill-pairing-plugin` | Agent discovery, pairing flow, token generation | 🔨 Planned |
| `krill-safe-plugin` | Per-message authentication and validation | 🔨 Planned |

## Development Order

1. **enrollment** → Marca agents al servidor (prerequisit per tot)
2. **pairing** → Usuaris s'emparellen amb agents marcats  
3. **safe** → Valida cada missatge amb token del pairing

## Key Concepts

- **Agents**: AI entities marked with unforgeable server attributes
- **Pairing**: Per-device binding between user and agent, generates shared token
- **Senses**: Permissions/capabilities granted by user to agent post-pairing
- **Token auth**: Every message authenticated with pairing token

## Structure

```
krill-plugins/
├── docs/
│   └── ARCHITECTURE.md
├── plugins/
│   ├── krill-pairing-plugin/
│   ├── krill-safe-plugin/
│   └── krill-matrix-plugin/
└── README.md
```

## License

MIT
