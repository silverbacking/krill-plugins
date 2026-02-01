# Krill Security Analysis

## Vulnerabilitats Potencials i Mitigacions

### 1. Token Bruteforce

**Risc:** Un atacant podria intentar endevinar tokens de pairing.

**Anàlisi:**
- Token = 32 bytes random = 256 bits d'entropia
- Espai de cerca: 2^256 possibilitats
- Pràcticament impossible per força bruta

**Mitigació adicional:**
- Rate limiting al endpoint de validació
- Bloqueig temporal després de X intents fallits
- Logging d'intents fallits per detectar atacs

```yaml
# Config recomanada
krill-safe:
  rateLimiting:
    maxAttempts: 5
    windowSeconds: 60
    blockSeconds: 300
```

### 2. Token Theft (Man-in-the-Middle)

**Risc:** El token es transmet via Matrix. Si Matrix està compromès, el token pot ser robat.

**Mitigació:**
- Matrix usa TLS (HTTPS)
- E2EE opcional (recomanat per a usuaris sensibles)
- El token només es transmet en el moment del pairing
- Després, s'inclou en cada missatge però el canal ja és establert

**Recomanació:**
- Activar E2EE per defecte a rooms de Krill
- Implementar certificate pinning a l'app

### 3. Token Replay

**Risc:** Un atacant intercepta un missatge i el reenvia.

**Mitigació actual:**
- El camp `nonce` i `timestamp` permeten detectar replays

**Implementació recomanada:**
```json
{
  "ai.krill.auth": {
    "pairing_token": "krill_tk_...",
    "timestamp": 1706820000,
    "nonce": "random-unique-id",
    "signature": "hmac-of-body-with-token"
  }
}
```

El gateway:
1. Verifica que timestamp és recent (< 5 min)
2. Verifica que nonce no s'ha vist abans (cache)
3. Verifica signature = HMAC(message_body, token)

### 4. State Events Públics

**Risc:** Qualsevol pot veure els agents registrats i els seus hashes.

**Anàlisi:**
- El `verification_hash` no revela el `gateway_secret`
- HMAC és one-way - no es pot derivar el secret del hash
- Però un atacant sap quins agents existeixen

**Mitigació:**
- Això és acceptable - el catàleg ha de ser públic per descobrir agents
- El hash és inútil sense el secret
- L'únic risc és enumeració d'agents (no és crític)

### 5. Gateway Secret Compromès

**Risc:** Si algú obté el `gateway_secret`, pot:
- Generar hashes de verificació vàlids
- Fer-se passar per agents del gateway

**Mitigació:**
- El secret mai surt del gateway
- Emmagatzemar de forma segura (env vars, secrets manager)
- Rotació periòdica del secret (requereix re-enrollment)
- Monitoring d'anomalies (nous agents inesperats)

**Recomanació:**
```bash
# Generar un secret fort
openssl rand -hex 64
```

### 6. Pairing Token Robat

**Risc:** Si un atacant roba el token d'un usuari legítim:
- Pot enviar missatges com aquell usuari
- Pot accedir als senses de l'usuari

**Mitigació:**
- L'app guarda el token al Keychain/Keystore (protegit per biometria)
- L'usuari pot revocar pairings des de l'app
- Alertes per activitat sospitosa (nou dispositiu, ubicació inusual)
- Expiració opcional de tokens

**Recomanació:**
- Notificar l'usuari quan hi ha activitat des d'un dispositiu
- Permetre "logout all devices" des de l'app

### 7. DoS (Denial of Service)

**Risc:** Un atacant podria:
- Fer moltes peticions de pairing
- Enviar molts missatges invàlids
- Consumir recursos del gateway

**Mitigació:**
- Rate limiting per IP
- Rate limiting per user_mxid
- Límit de pairings per gateway
- Cloudflare protecció DDoS

```yaml
krill-safe:
  limits:
    pairingsPerAgent: 100
    pairingsPerUser: 5
    messagesPerMinute: 60
```

### 8. Impersonation d'Agent

**Risc:** Algú crea un compte Matrix amb nom similar a un agent legítim.

**Mitigació:**
- L'agent ha d'estar registrat a la room de catàleg amb hash vàlid
- Krill App només mostra agents verificats
- Advertència si l'usuari intenta parlar amb un agent no verificat

**UI recomanada:**
```
✅ Jarvis (verificat)
⚠️ J4rvis (no verificat - possible impostor!)
```

### 9. Room de Catàleg Falsa

**Risc:** Un atacant crea una room que sembla el catàleg oficial.

**Mitigació:**
- L'app usa un mètode de descobriment fix (well-known o alias estàndard)
- Verificar que el sender dels state events és l'admin esperat
- Hardcode del room_id oficial per a Krill Cloud

### 10. Senses Data Leakage

**Risc:** L'agent podria abusar dels senses (ubicació, fotos, etc.).

**Mitigació:**
- L'usuari controla exactament quins senses activa
- Cada petició de sense mostra un popup a l'app
- Log d'accessos a senses visible per l'usuari
- L'usuari pot revocar senses en qualsevol moment

---

## Matriu de Riscos

| Vulnerabilitat | Probabilitat | Impacte | Prioritat |
|----------------|--------------|---------|-----------|
| Token bruteforce | Molt baixa | Alt | Baixa |
| Token theft (MitM) | Baixa | Alt | Mitjana |
| Token replay | Baixa | Mitjà | Mitjana |
| State events públics | N/A | Baix | Baixa |
| Secret compromès | Baixa | Crític | Alta |
| Pairing token robat | Mitjana | Alt | Alta |
| DoS | Mitjana | Mitjà | Mitjana |
| Impersonation | Baixa | Alt | Mitjana |
| Room falsa | Baixa | Alt | Mitjana |
| Senses leakage | Mitjana | Alt | Alta |

---

## Recomanacions de Seguretat

### Per l'Usuari Final
1. Activar biometria al dispositiu
2. No compartir el token
3. Revisar senses periòdicament
4. Revocar pairings de dispositius antics

### Per l'Operador del Gateway
1. Generar secrets forts (64 bytes)
2. No loguejar secrets ni tokens
3. Activar rate limiting
4. Monitorar activitat sospitosa
5. Fer backups segurs de pairings

### Per al Desenvolupament
1. Implementar E2EE per defecte
2. Afegir nonce i signature als missatges
3. Implementar expiració de tokens (opcional)
4. Afegir alertes per activitat anòmala
5. Auditar el codi regularment

---

## Checklist de Seguretat Pre-Launch

- [ ] Rate limiting implementat
- [ ] Secrets emmagatzemats de forma segura
- [ ] TLS configurat correctament
- [ ] Tokens amb entropia suficient
- [ ] Logging sense dades sensibles
- [ ] Tests de penetració realitzats
- [ ] Documentació de seguretat per usuaris
- [ ] Pla de resposta a incidents
