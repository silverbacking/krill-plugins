#!/usr/bin/env bash
#
# deploy-to-central.sh — Deploy krill plugins to central-node
#
# Usage:
#   ./scripts/deploy-to-central.sh [plugin-name]   # Deploy one plugin
#   ./scripts/deploy-to-central.sh                  # Deploy ALL official plugins
#
# Requirements:
#   - SSH access to central-node via Tailscale
#   - npm, node, tsc installed locally
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
CENTRAL_HOST="root@100.98.141.108"
CENTRAL_PLUGINS_DIR="/opt/krill/plugins"
SSH_KEY="$HOME/jarvisx/.secrets/hetzner-krill-node.key"
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=15"

# Official plugins (order matters: dependencies first)
OFFICIAL_PLUGINS=(krill-agent-init krill-email krill-matrix-protocol krill-update)

log()  { echo -e "\033[1;34m[deploy]\033[0m $*"; }
ok()   { echo -e "\033[1;32m  ✅\033[0m $*"; }
warn() { echo -e "\033[1;33m  ⚠️\033[0m $*"; }
err()  { echo -e "\033[1;31m  ❌\033[0m $*"; }

deploy_plugin() {
  local plugin="$1"
  local plugin_dir="$REPO_DIR/$plugin"

  if [[ ! -d "$plugin_dir" ]]; then
    err "Plugin directory not found: $plugin_dir"
    return 1
  fi

  log "═══════════════════════════════════════"
  log "Deploying $plugin"
  log "═══════════════════════════════════════"

  cd "$plugin_dir"

  # 1. Read version from package.json
  local version
  version=$(node -e "console.log(require('./package.json').version)")
  log "Version: $version"

  # 2. Build TypeScript (if tsconfig.json exists)
  if [[ -f "tsconfig.json" ]]; then
    log "Building TypeScript..."
    npx tsc --skipLibCheck 2>/dev/null || {
      warn "tsc failed, checking if dist/ already exists..."
      if [[ ! -f "dist/index.js" ]] && [[ ! -f "index.js" ]]; then
        err "No compiled output found. Fix build errors first."
        return 1
      fi
    }
    ok "Build complete"
  fi

  # 3. Package with npm pack
  log "Packaging..."
  local tgz_file
  tgz_file=$(npm pack --pack-destination . 2>/dev/null | tail -1)
  if [[ ! -f "$tgz_file" ]]; then
    err "npm pack failed — no .tgz produced"
    return 1
  fi
  ok "Created $tgz_file"

  # 4. Calculate SHA256
  local checksum
  checksum="sha256:$(shasum -a 256 "$tgz_file" | cut -d' ' -f1)"
  log "Checksum: $checksum"

  # 5. Generate latest.json
  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  cat > latest.json <<EOF
{
  "plugin": "$plugin",
  "version": "$version",
  "filename": "$tgz_file",
  "checksum": "$checksum",
  "packaged_at": "$now"
}
EOF
  ok "Generated latest.json"

  # 6. Upload to central-node
  log "Uploading to central-node..."

  # Create plugin dir on server if needed
  ssh $SSH_OPTS "$CENTRAL_HOST" "mkdir -p $CENTRAL_PLUGINS_DIR/$plugin" 2>/dev/null

  # Clean old .tgz files on server (keep only the new one)
  log "Cleaning old .tgz files on server..."
  ssh $SSH_OPTS "$CENTRAL_HOST" "rm -f $CENTRAL_PLUGINS_DIR/$plugin/*.tgz $CENTRAL_PLUGINS_DIR/$plugin/*.tgz.sha256" 2>/dev/null
  ok "Old packages removed"

  # Upload new .tgz + latest.json
  scp $SSH_OPTS "$tgz_file" "$CENTRAL_HOST:$CENTRAL_PLUGINS_DIR/$plugin/" 2>/dev/null
  scp $SSH_OPTS "latest.json" "$CENTRAL_HOST:$CENTRAL_PLUGINS_DIR/$plugin/" 2>/dev/null
  ok "Uploaded to $CENTRAL_PLUGINS_DIR/$plugin/"

  # Also upload checksum file
  echo "$checksum  $tgz_file" > "$tgz_file.sha256"
  scp $SSH_OPTS "$tgz_file.sha256" "$CENTRAL_HOST:$CENTRAL_PLUGINS_DIR/$plugin/" 2>/dev/null

  # 7. Verify API reflects the new version
  log "Verifying API..."
  local api_version
  api_version=$(ssh $SSH_OPTS "$CENTRAL_HOST" \
    "curl -s http://localhost:3000/v1/plugins | python3 -c \"import sys,json; plugins=json.load(sys.stdin)['plugins']; match=[p for p in plugins if p['name']=='$plugin']; print(match[0]['version'] if match else 'NOT_FOUND')\"" 2>/dev/null)

  if [[ "$api_version" == "$version" ]]; then
    ok "API reports $plugin v$version ✓"
  else
    warn "API reports v$api_version (expected v$version). API may need restart or re-scan."
  fi

  # Clean up local .tgz.sha256
  rm -f "$tgz_file.sha256"

  echo ""
}

cleanup_legacy() {
  log "Cleaning legacy packages from /opt/krill/plugin-packages/..."
  ssh $SSH_OPTS "$CENTRAL_HOST" "rm -rf /opt/krill/plugin-packages/*" 2>/dev/null
  ok "Legacy plugin-packages cleaned"

  # Also remove stray .tgz in plugins root
  ssh $SSH_OPTS "$CENTRAL_HOST" "rm -f $CENTRAL_PLUGINS_DIR/*.tgz $CENTRAL_PLUGINS_DIR/latest.json" 2>/dev/null
  ok "Stray files in plugins root cleaned"
}

verify_all() {
  log "═══════════════════════════════════════"
  log "Final verification — API plugin registry"
  log "═══════════════════════════════════════"
  ssh $SSH_OPTS "$CENTRAL_HOST" \
    "curl -s http://localhost:3000/v1/plugins | python3 -m json.tool" 2>/dev/null
}

# --- Main ---

if [[ $# -gt 0 ]]; then
  # Deploy specific plugin(s)
  for plugin in "$@"; do
    deploy_plugin "$plugin"
  done
else
  # Deploy all official plugins
  for plugin in "${OFFICIAL_PLUGINS[@]}"; do
    deploy_plugin "$plugin"
  done
  cleanup_legacy
fi

verify_all

log "Done! 🎉"
