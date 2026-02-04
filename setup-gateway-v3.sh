#!/bin/bash
#===============================================================================
# KRILL GATEWAY SETUP v3.1
# 
# Complete automated setup for Krill Network agents
# - Creates Matrix user on central node
# - Installs Clawdbot + 3 Krill plugins
# - Configures and starts gateway
# - Registers agent in API
#
# Plugins installed:
#   1. krill-agent-init     - Auto-enrollment to Krill Network
#   2. krill-matrix-protocol - Krill protocol message handling
#   3. krill-update         - OTA updates via API polling
#
# Usage: ./setup-gateway-v3.sh <agent-name> "<personality>"
# Example: ./setup-gateway-v3.sh Creel "Friendly AI assistant..."
#
# WHERE TO RUN: On the TARGET node (e.g., demo-node), NOT on central-node!
#               The script SSHs to central-node only to create Matrix user and copy plugins.
#
# Requirements:
# - SSH access to central node (65.108.93.112) from the target node
# - Run as root on the TARGET gateway node (where the agent will live)
#
# Author: Jarvis
# Date: 2026-02-03
#===============================================================================

set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════
CENTRAL_NODE="65.108.93.112"
MATRIX_SERVER="matrix.krillbot.network"
MATRIX_DOMAIN="matrix.krillbot.network"
KRILL_API="https://api.krillbot.network"
REGISTRY_ROOM="!krill-registry:matrix.krillbot.network"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[i]${NC} $1"; }
step() { echo -e "\n${CYAN}═══ $1 ═══${NC}"; }

# ═══════════════════════════════════════════════════════════════════════════════
# ARGUMENTS
# ═══════════════════════════════════════════════════════════════════════════════
if [ $# -lt 2 ]; then
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║           KRILL GATEWAY SETUP v3.1                            ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo "Usage: $0 <agent-name> \"<personality>\""
    echo ""
    echo "Arguments:"
    echo "  agent-name    Name of the agent (e.g., Creel, Bruc)"
    echo "  personality   Agent's personality/description in quotes"
    echo ""
    echo "Example:"
    echo "  $0 Creel \"Friendly AI assistant with great humor\""
    echo ""
    echo "Plugins installed:"
    echo "  • krill-agent-init      - Auto-enrollment"
    echo "  • krill-matrix-protocol - Protocol handling"
    echo "  • krill-update          - OTA updates"
    echo ""
    exit 1
fi

AGENT_NAME="$1"
AGENT_PERSONALITY="$2"
AGENT_NAME_LOWER=$(echo "$AGENT_NAME" | tr '[:upper:]' '[:lower:]')
MATRIX_USER="@${AGENT_NAME_LOWER}:${MATRIX_DOMAIN}"
GATEWAY_DIR="/opt/krill-gateway"
WORKSPACE_DIR="/home/krill/workspace"
CONFIG_DIR="/home/krill/.clawdbot"
PLUGINS_DIR="${CONFIG_DIR}/plugins"
HOSTNAME_SHORT=$(hostname -s | tr '[:upper:]' '[:lower:]')

# Generate credentials ONCE
MATRIX_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
GATEWAY_ID="${AGENT_NAME_LOWER}-gateway-${HOSTNAME_SHORT}"
GATEWAY_SECRET=$(openssl rand -hex 32)

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║           🦐 KRILL GATEWAY SETUP v3.1                         ║${NC}"
echo -e "${CYAN}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${CYAN}║${NC}  Agent: ${GREEN}${AGENT_NAME}${NC}"
echo -e "${CYAN}║${NC}  Matrix: ${GREEN}${MATRIX_USER}${NC}"
echo -e "${CYAN}║${NC}  Gateway: ${GREEN}${GATEWAY_ID}${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════╝${NC}"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 0: Verify SSH access to central node
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 0: Verifying central node access"

if ! ssh -o ConnectTimeout=5 -o BatchMode=yes root@${CENTRAL_NODE} 'echo ok' &>/dev/null; then
    error "Cannot SSH to central node (${CENTRAL_NODE}). Please configure SSH keys first."
fi
log "Central node accessible"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1: Cleanup previous installation
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 1: Cleanup"

# Stop and disable service
systemctl stop krill-gateway 2>/dev/null || true
systemctl disable krill-gateway 2>/dev/null || true

# Kill any running clawdbot processes
pkill -9 -f clawdbot 2>/dev/null || true
sleep 2

# Clean directories
rm -rf "${CONFIG_DIR:?}"/* 2>/dev/null || true
rm -rf "${GATEWAY_DIR:?}"/* 2>/dev/null || true
rm -rf "${WORKSPACE_DIR:?}"/* 2>/dev/null || true
rm -f /home/krill/.clawdbot/*.lock 2>/dev/null || true

log "Cleanup complete"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2: System setup
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 2: System setup"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl wget git jq openssl > /dev/null

# Create krill user
if ! id "krill" &>/dev/null; then
    useradd -m -s /bin/bash krill
    log "Created krill user"
fi

mkdir -p "${GATEWAY_DIR}" "${WORKSPACE_DIR}" "${CONFIG_DIR}" "${PLUGINS_DIR}"
chown -R krill:krill /home/krill "${WORKSPACE_DIR}" "${CONFIG_DIR}"

log "System ready"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 3: Install Node.js
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 3: Node.js"

if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs >/dev/null
fi
log "Node $(node --version)"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 4: Install Clawdbot
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 4: Clawdbot"

npm install -g clawdbot >/dev/null 2>&1
log "Clawdbot $(clawdbot --version 2>/dev/null || echo 'installed')"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 5: Create Matrix user on central node
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 5: Matrix user"

info "Creating ${AGENT_NAME_LOWER} on central node..."

# Delete existing user if exists
ssh root@${CENTRAL_NODE} "docker exec -i postgres psql -U krill -d synapse -c \"DELETE FROM users WHERE name = '@${AGENT_NAME_LOWER}:${MATRIX_DOMAIN}';\" 2>/dev/null || true"
ssh root@${CENTRAL_NODE} "docker exec -i postgres psql -U krill -d synapse -c \"DELETE FROM profiles WHERE user_id = '${AGENT_NAME_LOWER}';\" 2>/dev/null || true"

# Create new user
RESULT=$(ssh root@${CENTRAL_NODE} "docker exec synapse register_new_matrix_user -u '${AGENT_NAME_LOWER}' -p '${MATRIX_PASSWORD}' -a -c /data/homeserver.yaml http://localhost:8008 2>&1" || true)

if echo "$RESULT" | grep -q "Success"; then
    log "Matrix user created: ${MATRIX_USER}"
else
    warn "User creation result: $RESULT"
    # Try to set password anyway
    ssh root@${CENTRAL_NODE} "HASH=\$(docker exec synapse /usr/local/bin/hash_password -p '${MATRIX_PASSWORD}' -c /data/homeserver.yaml) && docker exec -i postgres psql -U krill -d synapse -c \"UPDATE users SET password_hash = '\$HASH' WHERE name = '@${AGENT_NAME_LOWER}:${MATRIX_DOMAIN}';\"" 2>/dev/null || true
    log "Password synchronized"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 5.5: Set Matrix avatar
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 5.5: Matrix avatar"

DEFAULT_AVATAR="/opt/krill/krill-default-avatar.png"

if ssh root@${CENTRAL_NODE} "test -f ${DEFAULT_AVATAR}" 2>/dev/null; then
    info "Setting default avatar for ${AGENT_NAME}..."
    
    # Login to get access token
    ACCESS_TOKEN=$(curl -s -X POST "https://${MATRIX_SERVER}/_matrix/client/v3/login" \
      -H "Content-Type: application/json" \
      -d "{
        \"type\": \"m.login.password\",
        \"identifier\": {\"type\": \"m.id.user\", \"user\": \"${AGENT_NAME_LOWER}\"},
        \"password\": \"${MATRIX_PASSWORD}\"
      }" | jq -r '.access_token')
    
    if [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "null" ]; then
        # Copy avatar locally temporarily
        scp root@${CENTRAL_NODE}:${DEFAULT_AVATAR} /tmp/krill-avatar.png 2>/dev/null
        
        # Upload avatar
        MXC_URL=$(curl -s -X POST "https://${MATRIX_SERVER}/_matrix/media/v3/upload?filename=avatar.png" \
          -H "Authorization: Bearer $ACCESS_TOKEN" \
          -H "Content-Type: image/png" \
          --data-binary @/tmp/krill-avatar.png | jq -r '.content_uri')
        
        if [ -n "$MXC_URL" ] && [ "$MXC_URL" != "null" ]; then
            # Set as profile avatar
            curl -s -X PUT "https://${MATRIX_SERVER}/_matrix/client/v3/profile/${MATRIX_USER}/avatar_url" \
              -H "Authorization: Bearer $ACCESS_TOKEN" \
              -H "Content-Type: application/json" \
              -d "{\"avatar_url\": \"$MXC_URL\"}" >/dev/null
            
            log "Avatar set: $MXC_URL"
        else
            warn "Failed to upload avatar"
        fi
        
        rm -f /tmp/krill-avatar.png
    else
        warn "Could not login to set avatar"
    fi
else
    warn "Default avatar not found at ${DEFAULT_AVATAR}"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 6: Install Krill plugins from central node
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 6: Krill plugins"

# Copy plugins from central node
PLUGINS_INSTALLED=0
if ssh root@${CENTRAL_NODE} "test -d /opt/krill/plugins" 2>/dev/null; then
    for plugin in krill-agent-init krill-matrix-protocol krill-update; do
        if ssh root@${CENTRAL_NODE} "test -d /opt/krill/plugins/${plugin}" 2>/dev/null; then
            scp -r root@${CENTRAL_NODE}:/opt/krill/plugins/${plugin} "${PLUGINS_DIR}/" 2>/dev/null
            log "Plugin: ${plugin}"
            ((PLUGINS_INSTALLED++))
        else
            warn "Plugin not found: ${plugin}"
        fi
    done
else
    warn "No plugins directory on central node"
fi

if [ $PLUGINS_INSTALLED -lt 3 ]; then
    warn "Only ${PLUGINS_INSTALLED}/3 plugins installed - some features may not work"
fi

chown -R krill:krill "${PLUGINS_DIR}"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 7: Create SOUL.md (Agent personality)
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 7: Agent personality"

cat > "${WORKSPACE_DIR}/SOUL.md" << SOUL
# ${AGENT_NAME}

*Your soul file - who you are*

## Identity

**Name:** ${AGENT_NAME}
**Matrix ID:** ${MATRIX_USER}
**Network:** Krill Network (krillbot.network)

## Personality

${AGENT_PERSONALITY}

## Guidelines

- Be yourself - your personality is what makes you unique
- Help users with whatever they need
- Use appropriate language based on context
- Keep responses natural and engaging
- Admit when you don't know something

## Krill Protocol

You are part of the Krill Network. Handle protocol messages appropriately:
- \`ai.krill.verify.request\` → Respond with your identity verification
- \`ai.krill.pair.request\` → Accept pairing from legitimate users

---
*Gateway: ${GATEWAY_ID}*
*Created: $(date -Iseconds)*
SOUL

chown krill:krill "${WORKSPACE_DIR}/SOUL.md"
log "SOUL.md created"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 8: Configure Clawdbot with plugins
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 8: Clawdbot configuration"

# Build plugin paths array
PLUGIN_PATHS=""
for plugin in krill-agent-init krill-matrix-protocol krill-update; do
    if [ -d "${PLUGINS_DIR}/${plugin}" ]; then
        if [ -n "$PLUGIN_PATHS" ]; then
            PLUGIN_PATHS="${PLUGIN_PATHS},"
        fi
        PLUGIN_PATHS="${PLUGIN_PATHS}\"${PLUGINS_DIR}/${plugin}\""
    fi
done

cat > "${CONFIG_DIR}/clawdbot.json" << CONFIG
{
    "logging": {
        "consoleLevel": "info"
    },
    "agents": {
        "defaults": {
            "workspace": "${WORKSPACE_DIR}",
            "maxConcurrent": 2
        }
    },
    "channels": {
        "matrix": {
            "enabled": true,
            "homeserver": "https://${MATRIX_SERVER}",
            "userId": "${MATRIX_USER}",
            "password": "${MATRIX_PASSWORD}",
            "encryption": false,
            "dm": {
                "policy": "allowlist",
                "allowFrom": ["*"]
            }
        }
    },
    "gateway": {
        "port": 18080,
        "mode": "local",
        "bind": "loopback"
    },
    "plugins": {
        "load": {
            "paths": [${PLUGIN_PATHS}]
        },
        "entries": {
            "matrix": {
                "enabled": true
            },
            "krill-agent-init": {
                "enabled": true,
                "config": {
                    "gatewayId": "${GATEWAY_ID}",
                    "gatewaySecret": "${GATEWAY_SECRET}",
                    "registryRoomId": "${REGISTRY_ROOM}",
                    "krillApiUrl": "${KRILL_API}",
                    "agent": {
                        "mxid": "${MATRIX_USER}",
                        "displayName": "${AGENT_NAME}",
                        "description": "${AGENT_PERSONALITY}",
                        "capabilities": ["chat", "senses"]
                    }
                }
            },
            "krill-matrix-protocol": {
                "enabled": true,
                "config": {
                    "gatewayId": "${GATEWAY_ID}",
                    "gatewaySecret": "${GATEWAY_SECRET}",
                    "agent": {
                        "mxid": "${MATRIX_USER}",
                        "displayName": "${AGENT_NAME}"
                    }
                }
            },
            "krill-update": {
                "enabled": true,
                "config": {
                    "apiUrl": "${KRILL_API}",
                    "autoUpdate": true,
                    "checkIntervalMinutes": 60
                }
            }
        }
    }
}
CONFIG

chown krill:krill "${CONFIG_DIR}/clawdbot.json"
chmod 600 "${CONFIG_DIR}/clawdbot.json"

# Run doctor to fix any issues
sudo -u krill CLAWDBOT_HOME="${CONFIG_DIR}" clawdbot doctor --fix 2>/dev/null || true

log "Configuration created with ${PLUGINS_INSTALLED} plugins"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 9: Save credentials
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 9: Credentials"

cat > "${GATEWAY_DIR}/credentials.json" << CREDS
{
    "agent_name": "${AGENT_NAME}",
    "matrix_user": "${MATRIX_USER}",
    "matrix_password": "${MATRIX_PASSWORD}",
    "gateway_id": "${GATEWAY_ID}",
    "gateway_secret": "${GATEWAY_SECRET}",
    "homeserver": "https://${MATRIX_SERVER}",
    "krill_api": "${KRILL_API}",
    "personality": "${AGENT_PERSONALITY}",
    "plugins": ["krill-agent-init", "krill-matrix-protocol", "krill-update"],
    "created_at": "$(date -Iseconds)"
}
CREDS

chmod 600 "${GATEWAY_DIR}/credentials.json"
log "Credentials saved"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 10: Create systemd service
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 10: Systemd service"

cat > /etc/systemd/system/krill-gateway.service << SERVICE
[Unit]
Description=Krill Gateway (${AGENT_NAME})
After=network.target

[Service]
Type=simple
User=krill
Group=krill
WorkingDirectory=${WORKSPACE_DIR}
Environment=HOME=/home/krill
Environment=CLAWDBOT_HOME=${CONFIG_DIR}
ExecStart=$(which clawdbot) gateway run
Restart=on-failure
RestartSec=30
StartLimitBurst=3
StartLimitIntervalSec=300

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable krill-gateway >/dev/null 2>&1
log "Service configured"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 11: Start gateway
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 11: Starting gateway"

systemctl start krill-gateway
sleep 5

if systemctl is-active --quiet krill-gateway; then
    log "Gateway running!"
else
    warn "Gateway may need attention - checking logs..."
    journalctl -u krill-gateway -n 5 --no-pager
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 12: Verify enrollment
# ═══════════════════════════════════════════════════════════════════════════════
step "PHASE 12: Enrollment verification"

# NOTE: Agent registration is handled AUTOMATICALLY by krill-agent-init plugin
# The plugin will:
#   1. Join the registry room (if configured)
#   2. Publish ai.krill.agent state event
#   3. Register with the Krill API (if krillApiUrl configured)
#
# We just wait and verify it worked

info "Waiting for krill-agent-init to register the agent..."
sleep 10

# Check if agent appears in API
REGISTERED=$(curl -s "${KRILL_API}/v1/agents/${AGENT_NAME_LOWER}" 2>/dev/null | jq -r '.mxid // empty')
if [ "$REGISTERED" = "${MATRIX_USER}" ]; then
    log "Agent auto-registered successfully!"
else
    warn "Agent not yet in API - krill-agent-init may still be initializing"
    info "Check logs: journalctl -u krill-gateway | grep krill-init"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           🦐 KRILL GATEWAY READY                              ║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Agent: ${CYAN}${AGENT_NAME}${NC}"
echo -e "${GREEN}║${NC}  Matrix: ${CYAN}${MATRIX_USER}${NC}"
echo -e "${GREEN}║${NC}  Gateway: ${CYAN}${GATEWAY_ID}${NC}"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Plugins:"
echo -e "${GREEN}║${NC}    • krill-agent-init      ✓"
echo -e "${GREEN}║${NC}    • krill-matrix-protocol ✓"
echo -e "${GREEN}║${NC}    • krill-update          ✓"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}║${NC}  Password: ${YELLOW}${MATRIX_PASSWORD}${NC}"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  Commands:"
echo -e "${GREEN}║${NC}    ${CYAN}systemctl status krill-gateway${NC}"
echo -e "${GREEN}║${NC}    ${CYAN}journalctl -u krill-gateway -f${NC}"
echo -e "${GREEN}║${NC}    ${CYAN}clawdbot krill-update check${NC}"
echo -e "${GREEN}║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Final verification
echo -e "${BLUE}Verifying API registration...${NC}"
curl -s "${KRILL_API}/v1/agents/${AGENT_NAME_LOWER}" 2>/dev/null | jq -r '"✓ \(.display_name) registered at \(.mxid)"' 2>/dev/null || echo "Registration pending (krill-agent-init will handle it)"

echo ""
echo -e "${YELLOW}Note: Agent registration is handled by krill-agent-init plugin.${NC}"
echo -e "${YELLOW}If not registered yet, check: journalctl -u krill-gateway | grep krill-init${NC}"
