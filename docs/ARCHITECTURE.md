# Krill Architecture

## Overview

Krill és un sistema de comunicació segura entre usuaris (humans) i agents (IA) sobre el protocol Matrix.

## Components

### KrillMatrix Server
Servidor Matrix modificat/estès amb capacitats Krill:
- Marcatge d'agents mitjançant atributs especials (no replicables per humans)
- Descobriment automàtic d'agents per a usuaris del mateix servidor
- Gestió de pairings i tokens

### Krill App
Aplicació client per a usuaris:
- Descobreix agents disponibles al servidor
- Gestiona pairings amb agents
- Configura "senses" (permisos/capacitats dels agents)
- Comunicació xifrada amb agents

### Agents
Entitats IA marcades com a agents al servidor:
- Atributs especials que els identifiquen (no falsificables per humans)
- Poden ser descoberts pels usuaris del mateix servidor
- Responen a pairings i dialoguen amb usuaris emparellats

---

## Flux de Pairing

```
┌─────────────┐                    ┌─────────────────┐                    ┌─────────────┐
│  Krill App  │                    │  KrillMatrix    │                    │    Agent    │
│  (usuari)   │                    │    Server       │                    │     (IA)    │
└──────┬──────┘                    └────────┬────────┘                    └──────┬──────┘
       │                                    │                                    │
       │  1. Descobreix agents              │                                    │
       │ ─────────────────────────────────► │                                    │
       │                                    │                                    │
       │  2. Llista d'agents disponibles    │                                    │
       │ ◄───────────────────────────────── │                                    │
       │                                    │                                    │
       │  3. Selecciona agent per pairing   │                                    │
       │ ─────────────────────────────────► │  4. Notifica pairing request       │
       │                                    │ ──────────────────────────────────►│
       │                                    │                                    │
       │                                    │  5. Agent accepta/rebutja          │
       │                                    │ ◄──────────────────────────────────│
       │                                    │                                    │
       │  6. Pairing result + TOKEN         │                                    │
       │ ◄───────────────────────────────── │                                    │
       │                                    │                                    │
       │  7. Comunicació autenticada amb TOKEN                                   │
       │ ◄─────────────────────────────────────────────────────────────────────►│
       │                                    │                                    │
```

## Regles de Pairing

1. **Per dispositiu**: El pairing és específic per a un usuari en un dispositiu concret
2. **Nou dispositiu = nou pairing**: Si l'usuari canvia de dispositiu, ha de fer un nou pairing
3. **Token compartit**: Usuari i agent comparteixen un token generat durant el pairing
4. **Autenticació contínua**: Cada missatge es valida amb el token del pairing

## Senses (Permisos)

Després del pairing, l'usuari pot configurar "senses" - permisos i capacitats que atorga a l'agent:
- Accés a calendari
- Accés a ubicació
- Accés a càmera/fotos
- Notificacions
- etc.

---

## Plugins

### krill-enrollment-plugin
Permet que un OpenClaw gateway registri els seus agents al servidor KrillMatrix:
- El gateway s'autentica amb el servidor
- Envia la llista d'agents que controla
- El servidor marca els agents amb atributs verificables
- Els agents queden disponibles per descobriment/pairing

**Flux d'enrollment:**
```
┌─────────────┐                    ┌─────────────────┐
│  OpenClaw   │                    │  KrillMatrix    │
│  Gateway    │                    │    Server       │
└──────┬──────┘                    └────────┬────────┘
       │                                    │
       │  1. Auth gateway (credentials)     │
       │ ─────────────────────────────────► │
       │                                    │
       │  2. Gateway token                  │
       │ ◄───────────────────────────────── │
       │                                    │
       │  3. Enroll agent (@jarvis:...)     │
       │ ─────────────────────────────────► │
       │                                    │
       │  4. Agent marked + certificate     │
       │ ◄───────────────────────────────── │
       │                                    │
```

### krill-pairing-plugin
Gestiona el flux complet de pairing:
- Registre d'agents al servidor (marcatge amb atributs especials)
- Descobriment d'agents per usuaris
- Handshake de pairing
- Generació i emmagatzematge de tokens
- Gestió de dispositius (un pairing per dispositiu)

### krill-safe-plugin
Validació de seguretat per a cada conversa:
- Verificació de token en cada missatge
- Validació de sessió activa
- Comprovació de permisos (senses)
- Rebuig de missatges no autenticats

---

## Atributs d'Agent (No Replicables)

Els agents es marquen amb atributs que els humans no poden replicar:
- Signatura criptogràfica del servidor
- Certificat d'agent emès pel servidor
- Metadades verificables a nivell de protocol

Això garanteix que un humà no pot fer-se passar per un agent.
