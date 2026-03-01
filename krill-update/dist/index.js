/**
 * Krill Update Plugin
 *
 * Auto-update system for Krill Network gateways.
 * Uses API polling only (scalable for high volume of agents).
 *
 * Features:
 * - Periodic plugin update checks
 * - Remote config updates via ai.krill.config.update Matrix messages
 *   with automatic rollback if gateway fails to start
 * - Heartbeat: POST /v1/agents/:id/heartbeat every 60s to report online status
 *
 * Depends on: krill-agent-init (for gatewayId/gatewaySecret/agentId)
 */
import { execSync, spawn } from "child_process";
import { createWriteStream, existsSync, mkdirSync, unlinkSync, readFileSync, writeFileSync, copyFileSync, readdirSync, rmSync } from "fs";
import { createHash, createHmac } from "crypto";
import { pipeline } from "stream/promises";
import { homedir, loadavg } from "os";
import { join } from "path";
import YAML from "js-yaml";
const DEFAULT_CONFIG = {
    apiUrl: "https://api.krillbot.network",
    autoUpdate: true,
    checkIntervalMinutes: 60,
    // Heartbeat defaults
    heartbeatIntervalSeconds: 60,
    heartbeatEnabled: true,
    // Config update defaults
    configPath: existsSync(join(homedir(), ".openclaw", "openclaw.json"))
        ? join(homedir(), ".openclaw", "openclaw.json")
        : existsSync(join(homedir(), ".openclaw", "openclaw.yaml"))
            ? join(homedir(), ".openclaw", "openclaw.yaml")
            : join(homedir(), ".clawdbot", "clawdbot.yaml"),
    restartCommand: existsSync("/usr/bin/openclaw") || existsSync("/usr/local/bin/openclaw")
        ? "openclaw gateway restart"
        : "systemctl restart clawdbot-gateway",
    healthCheckTimeoutSeconds: 30,
    allowedConfigSenders: [], // Empty = only admin users allowed
    skillsPath: "", // Auto-detected from config or ~/skills
};
let pluginConfig = DEFAULT_CONFIG;
let pluginApi = null;
let checkInterval = null;
let heartbeatInterval = null;
const gatewayStartTime = Date.now();
// Track installed plugin versions (auto-detected from extensions dir on startup)
const installedPlugins = new Map();
/**
 * Scan extensions directory to detect actually installed plugin versions.
 * This replaces the hardcoded 1.0.0 defaults that caused unnecessary reinstalls.
 */
function scanInstalledPlugins() {
    const extensionsDirs = [
        join(homedir(), ".openclaw", "extensions"),
        join(homedir(), ".clawdbot", "plugins"),
    ];
    for (const dir of extensionsDirs) {
        if (!existsSync(dir))
            continue;
        try {
            const entries = readdirSync(dir, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);
            for (const entry of entries) {
                const pkgPath = join(dir, entry, "package.json");
                if (existsSync(pkgPath)) {
                    try {
                        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
                        if (pkg.name && pkg.version) {
                            installedPlugins.set(pkg.name, pkg.version);
                        }
                    }
                    catch { /* skip malformed package.json */ }
                }
            }
        }
        catch { /* skip inaccessible dirs */ }
    }
    pluginApi?.logger.info(`[krill-update] Detected ${installedPlugins.size} installed plugin(s): ${[...installedPlugins.entries()].map(([n, v]) => `${n}@${v}`).join(", ")}`);
}
// Track installed skill versions
const installedSkills = new Map();
/**
 * Get gateway credentials from krill-agent-init config
 */
function getGatewayCredentials() {
    const initConfig = pluginApi?.config?.plugins?.entries?.["krill-agent-init"]?.config;
    if (!initConfig?.gatewayId || !initConfig?.gatewaySecret) {
        return null;
    }
    return {
        gatewayId: initConfig.gatewayId,
        gatewaySecret: initConfig.gatewaySecret,
    };
}
/**
 * Generate auth header for API requests
 */
function generateAuthHeader(plugin, version) {
    const creds = getGatewayCredentials();
    if (!creds)
        return null;
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `${creds.gatewayId}:${timestamp}:${plugin}:${version}`;
    const signature = createHmac("sha256", creds.gatewaySecret)
        .update(message)
        .digest("hex")
        .substring(0, 32);
    return `${creds.gatewayId}:${timestamp}:${signature}`;
}
/**
 * Verify file checksum
 */
function verifyChecksum(filePath, expectedChecksum) {
    const parts = expectedChecksum.split(":");
    const algo = parts.length === 2 ? parts[0] : "sha256";
    const hash = parts.length === 2 ? parts[1] : parts[0];
    if (algo !== "sha256") {
        pluginApi?.logger.warn(`[krill-update] Unsupported checksum algorithm: ${algo}`);
        return false;
    }
    const fileBuffer = readFileSync(filePath);
    const actualHash = createHash("sha256").update(fileBuffer).digest("hex");
    return actualHash === hash;
}
/**
 * Download and install a plugin update
 */
async function installUpdate(update) {
    const logger = pluginApi?.logger;
    logger?.info(`[krill-update] 📦 Installing ${update.plugin} v${update.version}...`);
    try {
        const tempDir = "/tmp/krill-updates";
        if (!existsSync(tempDir)) {
            mkdirSync(tempDir, { recursive: true });
        }
        const tempFile = `${tempDir}/${update.plugin}-${update.version}.tgz`;
        // Generate auth header
        const authHeader = generateAuthHeader(update.plugin, update.version);
        if (!authHeader) {
            throw new Error("Cannot generate auth - krill-agent-init not configured");
        }
        // Download with authentication
        logger?.info(`[krill-update] Downloading from ${update.download_url}...`);
        const response = await fetch(update.download_url, {
            headers: { "X-Krill-Auth": authHeader },
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Download failed: ${response.status} - ${error}`);
        }
        const fileStream = createWriteStream(tempFile);
        await pipeline(response.body, fileStream);
        // Verify checksum
        logger?.info(`[krill-update] Verifying checksum...`);
        if (!verifyChecksum(tempFile, update.checksum)) {
            unlinkSync(tempFile);
            throw new Error("Checksum verification failed!");
        }
        // Find the extensions directory (where OpenClaw loads plugins from at runtime)
        const extensionsDirs = [
            join(homedir(), ".openclaw", "extensions"),
            join(homedir(), ".clawdbot", "plugins"),
        ];
        const extensionsDir = extensionsDirs.find(d => existsSync(d));
        const targetDir = extensionsDir ? join(extensionsDir, update.plugin) : null;
        if (targetDir && existsSync(targetDir)) {
            // DIRECT EXTRACTION: Extract tgz key files directly to extensions dir
            // This is more reliable than npm install -g because:
            // 1. Avoids ENOTEMPTY errors (npm can't rename active directories)
            // 2. Works for self-updates (krill-update updating itself)
            // 3. Preserves existing node_modules in the extensions dir
            logger?.info(`[krill-update] 📦 Direct extraction to ${targetDir}`);
            const extractDir = join(tempDir, `extract-${update.plugin}`);
            mkdirSync(extractDir, { recursive: true });
            execSync(`tar xzf ${tempFile} -C ${extractDir}`, { stdio: "pipe" });
            // Clean target directory (preserve node_modules) then copy everything from package
            const packageDir = join(extractDir, "package");
            if (existsSync(packageDir)) {
                // Remove old files except node_modules
                const existing = readdirSync(targetDir);
                for (const entry of existing) {
                    if (entry === "node_modules")
                        continue;
                    rmSync(join(targetDir, entry), { recursive: true, force: true });
                }
                // Copy all files from extracted package
                const copyRecursive = (src, dest) => {
                    const stat = require("fs").statSync(src);
                    if (stat.isDirectory()) {
                        mkdirSync(dest, { recursive: true });
                        for (const child of readdirSync(src)) {
                            copyRecursive(join(src, child), join(dest, child));
                        }
                    }
                    else {
                        copyFileSync(src, dest);
                    }
                };
                for (const entry of readdirSync(packageDir)) {
                    copyRecursive(join(packageDir, entry), join(targetDir, entry));
                }
            }
            // If the package has new dependencies (node_modules), install them asynchronously
            const newPkgJson = join(packageDir, "package.json");
            if (existsSync(newPkgJson)) {
                const pkg = JSON.parse(readFileSync(newPkgJson, "utf-8"));
                if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
                    // Only run npm install if there are deps and no node_modules yet
                    if (!existsSync(join(targetDir, "node_modules"))) {
                        // Run npm install in background to avoid blocking Matrix sync
                        logger?.info(`[krill-update] Installing dependencies for ${update.plugin} (background)...`);
                        const child = spawn("npm", ["install", "--production"], {
                            cwd: targetDir,
                            stdio: "ignore",
                            detached: true,
                        });
                        child.unref();
                        child.on("exit", (code) => {
                            if (code === 0) {
                                logger?.info(`[krill-update] ✅ Dependencies installed for ${update.plugin}`);
                            }
                            else {
                                logger?.warn(`[krill-update] Dependency install failed for ${update.plugin} (code ${code})`);
                            }
                        });
                    }
                }
            }
            rmSync(extractDir, { recursive: true, force: true });
        }
        else {
            // FALLBACK: Create extensions dir and extract directly (no npm install -g)
            const extDir = join(homedir(), ".openclaw", "extensions", update.plugin);
            mkdirSync(extDir, { recursive: true });
            const extractDir = join(tempDir, `extract-${update.plugin}`);
            mkdirSync(extractDir, { recursive: true });
            execSync(`tar xzf ${tempFile} -C ${extractDir}`, { stdio: "pipe" });
            const packageDir = join(extractDir, "package");
            // Copy everything from package/ to extensions dir
            if (existsSync(packageDir)) {
                execSync(`cp -r ${packageDir}/* ${extDir}/`, { stdio: "pipe" });
            }
            // Ensure index.js shim exists for OpenClaw plugin loading
            const distIndex = join(extDir, "dist", "index.js");
            const rootIndex = join(extDir, "index.js");
            if (existsSync(distIndex) && !existsSync(rootIndex)) {
                writeFileSync(rootIndex, `module.exports = require("./dist/index.js");\n`);
            }
            rmSync(extractDir, { recursive: true, force: true });
            logger?.info(`[krill-update] 📦 First install: extracted to ${extDir}`);
        }
        // Cleanup temp file
        unlinkSync(tempFile);
        // Update tracked version
        installedPlugins.set(update.plugin, update.version);
        logger?.info(`[krill-update] ✅ ${update.plugin} v${update.version} installed!`);
        logger?.warn(`[krill-update] ⚠️ Gateway restart required to load new plugin version`);
        return true;
    }
    catch (error) {
        logger?.warn(`[krill-update] Installation failed: ${error}`);
        return false;
    }
}
/**
 * Scan installed skills to track versions
 */
function scanInstalledSkills() {
    const skillsPath = getSkillsPath();
    if (!skillsPath || !existsSync(skillsPath))
        return;
    installedSkills.clear();
    try {
        const dirs = readdirSync(skillsPath, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
        for (const dir of dirs) {
            // Check for SKILL.md (required) and version.json (optional)
            const skillMd = join(skillsPath, dir, "SKILL.md");
            if (!existsSync(skillMd))
                continue;
            const versionFile = join(skillsPath, dir, "version.json");
            let version = "0.0.0";
            if (existsSync(versionFile)) {
                try {
                    const meta = JSON.parse(readFileSync(versionFile, "utf-8"));
                    version = meta.version || "0.0.0";
                }
                catch { /* ignore */ }
            }
            installedSkills.set(dir, version);
        }
    }
    catch { /* skills dir doesn't exist yet */ }
}
/**
 * Get the skills installation path
 */
function getSkillsPath() {
    if (pluginConfig.skillsPath)
        return pluginConfig.skillsPath;
    // Try to find workspace from config
    const configContent = existsSync(pluginConfig.configPath)
        ? readFileSync(pluginConfig.configPath, "utf-8")
        : "";
    // Check for skills path in various config formats
    const workspaceMatch = configContent.match(/workspace['":\s]+['"]?([^\s'"]+)/);
    if (workspaceMatch) {
        const wsPath = workspaceMatch[1].replace("~", homedir());
        const skillsDir = join(wsPath, "skills");
        // Always use workspace/skills/ — create it if needed during install
        return skillsDir;
    }
    // Also try reading JSON config directly for workspace
    try {
        const config = JSON.parse(configContent);
        const ws = config?.agents?.defaults?.workspace;
        if (ws) {
            return join(ws.replace("~", homedir()), "skills");
        }
    }
    catch { /* not JSON */ }
    // Default: ~/skills
    return join(homedir(), "skills");
}
/**
 * Download and install a skill update
 */
async function installSkill(update) {
    const logger = pluginApi?.logger;
    const skillsPath = getSkillsPath();
    logger?.info(`[krill-update] 📦 Installing skill: ${update.plugin} v${update.version}...`);
    try {
        const tempDir = "/tmp/krill-updates";
        if (!existsSync(tempDir)) {
            mkdirSync(tempDir, { recursive: true });
        }
        const tempFile = `${tempDir}/${update.plugin}-${update.version}.tgz`;
        // Generate auth header
        const authHeader = generateAuthHeader(update.plugin, update.version);
        if (!authHeader) {
            throw new Error("Cannot generate auth - krill-agent-init not configured");
        }
        // Download
        logger?.info(`[krill-update] Downloading skill from ${update.download_url}...`);
        const response = await fetch(update.download_url, {
            headers: { "X-Krill-Auth": authHeader },
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Download failed: ${response.status} - ${error}`);
        }
        const fileStream = createWriteStream(tempFile);
        await pipeline(response.body, fileStream);
        // Verify checksum
        if (!verifyChecksum(tempFile, update.checksum)) {
            unlinkSync(tempFile);
            throw new Error("Checksum verification failed!");
        }
        // Extract to skills directory
        const skillDir = join(skillsPath, update.plugin);
        if (!existsSync(skillDir)) {
            mkdirSync(skillDir, { recursive: true });
        }
        // Extract .tgz (tar -xzf) into skill directory
        execSync(`tar -xzf ${tempFile} -C ${skillDir} --strip-components=1`, { stdio: "pipe" });
        // Write version.json for tracking
        writeFileSync(join(skillDir, "version.json"), JSON.stringify({ version: update.version, installed_at: new Date().toISOString() }, null, 2));
        // Cleanup
        unlinkSync(tempFile);
        installedSkills.set(update.plugin, update.version);
        logger?.info(`[krill-update] ✅ Skill ${update.plugin} v${update.version} installed to ${skillDir}`);
        return true;
    }
    catch (error) {
        logger?.warn(`[krill-update] Skill installation failed: ${error}`);
        return false;
    }
}
/**
 * Check for updates via API
 */
async function checkForUpdates() {
    const logger = pluginApi?.logger;
    logger?.info(`[krill-update] Checking for updates...`);
    const creds = getGatewayCredentials();
    if (!creds) {
        logger?.warn(`[krill-update] Cannot check updates - krill-agent-init not configured`);
        return;
    }
    try {
        const installed = {};
        for (const [name, version] of installedPlugins) {
            installed[name] = version;
        }
        // Scan and include installed skills
        scanInstalledSkills();
        const installedSkillsObj = {};
        for (const [name, version] of installedSkills) {
            installedSkillsObj[name] = version;
        }
        // Generate auth for check request
        const timestamp = Math.floor(Date.now() / 1000);
        const message = `${creds.gatewayId}:${timestamp}:check`;
        const signature = createHmac("sha256", creds.gatewaySecret)
            .update(message)
            .digest("hex")
            .substring(0, 32);
        const response = await fetch(`${pluginConfig.apiUrl}/v1/plugins/check-updates`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Krill-Auth": `${creds.gatewayId}:${timestamp}:${signature}`,
            },
            body: JSON.stringify({
                gateway_id: creds.gatewayId,
                installed,
                installed_skills: installedSkillsObj,
            }),
        });
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        const data = await response.json();
        const { updates, skill_updates, has_updates } = data;
        if (!has_updates) {
            logger?.info(`[krill-update] ✅ All plugins and skills up to date`);
            return;
        }
        // Process plugin updates
        if (updates?.length > 0) {
            logger?.info(`[krill-update] 🔔 ${updates.length} plugin update(s) available`);
            for (const update of updates) {
                logger?.info(`[krill-update] Available: ${update.plugin} ${update.current} → ${update.latest}`);
                if (pluginConfig.autoUpdate || update.required) {
                    await installUpdate({
                        plugin: update.plugin,
                        version: update.latest,
                        download_url: update.download_url,
                        checksum: update.checksum,
                        required: update.required,
                    });
                }
                else {
                    logger?.info(`[krill-update] Skipping (auto-update disabled)`);
                }
            }
        }
        // Process skill updates
        if (skill_updates?.length > 0) {
            logger?.info(`[krill-update] 🔔 ${skill_updates.length} skill update(s) available`);
            for (const update of skill_updates) {
                logger?.info(`[krill-update] Skill available: ${update.plugin} ${update.current} → ${update.latest}`);
                if (pluginConfig.autoUpdate || update.required) {
                    await installSkill({
                        plugin: update.plugin,
                        version: update.latest,
                        download_url: update.download_url,
                        checksum: update.checksum,
                        required: update.required,
                    });
                }
            }
        }
    }
    catch (error) {
        logger?.warn(`[krill-update] Check failed: ${error}`);
    }
}
// ============================================================================
// HEARTBEAT FUNCTIONALITY
// ============================================================================
/**
 * Get agent ID from krill-agent-init config
 */
function getAgentId() {
    const initConfig = pluginApi?.config?.plugins?.entries?.["krill-agent-init"]?.config;
    return initConfig?.agent?.id || null;
}
/**
 * Get OpenClaw version (best effort)
 */
function getOpenClawVersion() {
    try {
        const result = execSync("openclaw --version 2>/dev/null || echo unknown", {
            stdio: "pipe",
            timeout: 5000,
        }).toString().trim();
        return result !== "unknown" ? result : null;
    }
    catch {
        return null;
    }
}
/**
 * Send heartbeat to Krill API
 * POST /v1/agents/:agentId/heartbeat
 */
async function sendHeartbeat() {
    const logger = pluginApi?.logger;
    const creds = getGatewayCredentials();
    const agentId = getAgentId();
    if (!creds || !agentId) {
        // Silently skip — credentials not yet available (first boot)
        return;
    }
    try {
        const uptimeSeconds = Math.floor((Date.now() - gatewayStartTime) / 1000);
        const load = loadavg()[0].toFixed(2);
        const openclawVersion = getOpenClawVersion();
        const body = {
            gateway_secret: creds.gatewaySecret,
            status: "online",
            uptime_seconds: uptimeSeconds,
            load,
        };
        if (openclawVersion) {
            body.openclaw_version = openclawVersion;
            body.version = openclawVersion;
        }
        const response = await fetch(`${pluginConfig.apiUrl}/v1/agents/${agentId}/heartbeat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
            const err = await response.text().catch(() => "");
            logger?.warn(`[krill-heartbeat] Failed: ${response.status} ${err}`);
        }
        // Success is silent — no need to log every 60s
    }
    catch (error) {
        // Network errors are expected sometimes — only log occasionally
        if (Math.random() < 0.1) {
            logger?.warn(`[krill-heartbeat] Error: ${error.message || error}`);
        }
    }
}
// ============================================================================
// CONFIG UPDATE FUNCTIONALITY
// ============================================================================
/**
 * Deep merge two objects (config_patch into base config)
 */
function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
            result[key] = deepMerge(target[key] || {}, source[key]);
        }
        else {
            result[key] = source[key];
        }
    }
    return result;
}
/**
 * Create backup of config file
 */
function backupConfig(configPath) {
    const backupPath = `${configPath}.bak`;
    if (existsSync(configPath)) {
        copyFileSync(configPath, backupPath);
        pluginApi?.logger.info(`[krill-update] 📦 Config backed up to ${backupPath}`);
    }
    return backupPath;
}
/**
 * Restore config from backup
 */
function restoreConfig(configPath, backupPath) {
    try {
        if (existsSync(backupPath)) {
            copyFileSync(backupPath, configPath);
            pluginApi?.logger.info(`[krill-update] ⏪ Config restored from backup`);
            return true;
        }
        return false;
    }
    catch (error) {
        pluginApi?.logger.warn(`[krill-update] Failed to restore config: ${error}`);
        return false;
    }
}
/**
 * Apply config patch to YAML file
 */
function applyConfigPatch(configPath, patch) {
    try {
        let currentConfig = {};
        if (existsSync(configPath)) {
            const content = readFileSync(configPath, "utf-8");
            currentConfig = YAML.load(content) || {};
        }
        const newConfig = deepMerge(currentConfig, patch);
        const yamlContent = YAML.dump(newConfig, { lineWidth: 120, noRefs: true });
        writeFileSync(configPath, yamlContent, "utf-8");
        pluginApi?.logger.info(`[krill-update] ✅ Config patch applied`);
        return true;
    }
    catch (error) {
        pluginApi?.logger.warn(`[krill-update] Failed to apply config patch: ${error}`);
        return false;
    }
}
/**
 * Restart the gateway
 */
function restartGateway(command) {
    try {
        pluginApi?.logger.info(`[krill-update] 🔄 Restarting gateway: ${command}`);
        execSync(command, { stdio: "pipe", timeout: 10000 });
        return true;
    }
    catch (error) {
        pluginApi?.logger.warn(`[krill-update] Restart command failed: ${error}`);
        return false;
    }
}
/**
 * Check if gateway is healthy (responds to health check)
 */
async function checkGatewayHealth(timeoutSeconds) {
    const logger = pluginApi?.logger;
    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;
    logger?.info(`[krill-update] ⏳ Waiting for gateway to become healthy (${timeoutSeconds}s timeout)...`);
    // Wait a few seconds for the gateway to start
    await new Promise((r) => setTimeout(r, 5000));
    while (Date.now() - startTime < timeoutMs) {
        try {
            // Try to connect to the gateway's health endpoint or check process
            const result = execSync("pgrep -f clawdbot", { stdio: "pipe" }).toString().trim();
            if (result) {
                // Process is running, wait a bit more to ensure it's stable
                await new Promise((r) => setTimeout(r, 3000));
                // Check again
                const result2 = execSync("pgrep -f clawdbot", { stdio: "pipe" }).toString().trim();
                if (result2) {
                    logger?.info(`[krill-update] ✅ Gateway is healthy (PID: ${result2})`);
                    return true;
                }
            }
        }
        catch (error) {
            // Process not found, wait and retry
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
    logger?.warn(`[krill-update] ❌ Gateway health check timed out`);
    return false;
}
/**
 * Handle ai.krill.config.update Matrix event
 */
async function handleConfigUpdate(event) {
    const logger = pluginApi?.logger;
    const content = event.content;
    const requestId = content.request_id || event.event_id;
    logger?.info(`[krill-update] 📨 Received config update request from ${event.sender}`);
    // Security check: verify sender is allowed
    if (pluginConfig.allowedConfigSenders.length > 0) {
        if (!pluginConfig.allowedConfigSenders.includes(event.sender)) {
            logger?.warn(`[krill-update] ⛔ Sender ${event.sender} not in allowed list`);
            await sendConfigUpdateResult(event.room_id, requestId, false, "Sender not authorized");
            return true; // Event handled (rejected)
        }
    }
    // Validate content
    if (!content.config_patch || typeof content.config_patch !== "object") {
        logger?.warn(`[krill-update] Invalid config_patch in message`);
        await sendConfigUpdateResult(event.room_id, requestId, false, "Invalid config_patch");
        return true;
    }
    const configPath = pluginConfig.configPath;
    const backupPath = backupConfig(configPath);
    // Apply the patch
    const patchApplied = applyConfigPatch(configPath, content.config_patch);
    if (!patchApplied) {
        await sendConfigUpdateResult(event.room_id, requestId, false, "Failed to apply config patch");
        return true;
    }
    // Restart if requested
    if (content.restart !== false) {
        const restarted = restartGateway(pluginConfig.restartCommand);
        if (!restarted) {
            // Restart command failed, restore backup
            restoreConfig(configPath, backupPath);
            await sendConfigUpdateResult(event.room_id, requestId, false, "Restart command failed, config restored");
            return true;
        }
        // Wait and check health
        const isHealthy = await checkGatewayHealth(pluginConfig.healthCheckTimeoutSeconds);
        if (!isHealthy) {
            // Gateway didn't come up, ROLLBACK
            logger?.warn(`[krill-update] 🚨 Gateway unhealthy! Rolling back config...`);
            restoreConfig(configPath, backupPath);
            restartGateway(pluginConfig.restartCommand);
            // Wait for recovery
            const recovered = await checkGatewayHealth(pluginConfig.healthCheckTimeoutSeconds);
            if (recovered) {
                await sendConfigUpdateResult(event.room_id, requestId, false, "Gateway failed to start with new config. Rolled back successfully.");
            }
            else {
                await sendConfigUpdateResult(event.room_id, requestId, false, "CRITICAL: Gateway failed and rollback may have failed. Manual intervention required!");
            }
            return true;
        }
    }
    // Success!
    logger?.info(`[krill-update] ✅ Config update successful!`);
    await sendConfigUpdateResult(event.room_id, requestId, true, "Config updated successfully");
    return true;
}
/**
 * Send config update result back via Matrix
 */
async function sendConfigUpdateResult(roomId, requestId, success, message) {
    const response = {
        type: "ai.krill.config.update.result",
        content: {
            request_id: requestId,
            success,
            message,
            timestamp: Math.floor(Date.now() / 1000),
        },
    };
    try {
        if (pluginApi?.sendMatrixMessage) {
            await pluginApi.sendMatrixMessage(roomId, response);
        }
        else {
            pluginApi?.logger.info(`[krill-update] Result: ${JSON.stringify(response)}`);
        }
    }
    catch (error) {
        pluginApi?.logger.warn(`[krill-update] Failed to send result: ${error}`);
    }
}
// ============================================================================
const plugin = {
    id: "krill-update",
    name: "Krill Update",
    description: "Auto-update plugin for Krill Network gateways with remote config updates",
    configSchema: {
        type: "object",
        properties: {
            apiUrl: {
                type: "string",
                description: "Krill API URL for update checks",
                default: "https://api.krillbot.network",
            },
            autoUpdate: {
                type: "boolean",
                description: "Automatically install updates",
                default: true,
            },
            checkIntervalMinutes: {
                type: "number",
                description: "Minutes between update checks (0 to disable)",
                default: 60,
            },
            heartbeatEnabled: {
                type: "boolean",
                description: "Enable heartbeat reporting to Krill API",
                default: true,
            },
            heartbeatIntervalSeconds: {
                type: "number",
                description: "Seconds between heartbeat reports (min 30)",
                default: 60,
            },
            configPath: {
                type: "string",
                description: "Path to the gateway config file (clawdbot.yaml)",
                default: "~/.clawdbot/clawdbot.yaml",
            },
            restartCommand: {
                type: "string",
                description: "Command to restart the gateway after config changes",
                default: "systemctl restart clawdbot-gateway",
            },
            healthCheckTimeoutSeconds: {
                type: "number",
                description: "Seconds to wait for gateway to become healthy after restart",
                default: 30,
            },
            allowedConfigSenders: {
                type: "array",
                items: { type: "string" },
                description: "Matrix user IDs allowed to send config updates (empty = admin only)",
                default: [],
            },
        },
    },
    register(api) {
        pluginApi = api;
        // Load config
        const config = api.config?.plugins?.entries?.["krill-update"]?.config;
        pluginConfig = { ...DEFAULT_CONFIG, ...config };
        // Expand ~ in configPath
        if (pluginConfig.configPath.startsWith("~")) {
            pluginConfig.configPath = pluginConfig.configPath.replace("~", homedir());
        }
        // Scan extensions dir to detect actual installed versions
        scanInstalledPlugins();
        api.logger.info(`[krill-update] ✅ Plugin loaded`);
        api.logger.info(`[krill-update] API: ${pluginConfig.apiUrl}`);
        api.logger.info(`[krill-update] Auto-update: ${pluginConfig.autoUpdate}`);
        api.logger.info(`[krill-update] Check interval: ${pluginConfig.checkIntervalMinutes} min`);
        api.logger.info(`[krill-update] Config path: ${pluginConfig.configPath}`);
        // Start heartbeat timer
        if (pluginConfig.heartbeatEnabled && pluginConfig.heartbeatIntervalSeconds > 0) {
            const intervalMs = pluginConfig.heartbeatIntervalSeconds * 1000;
            // First heartbeat after 10s (give time for init)
            setTimeout(() => {
                sendHeartbeat();
                heartbeatInterval = setInterval(sendHeartbeat, intervalMs);
            }, 10_000);
            api.logger.info(`[krill-update] 💓 Heartbeat enabled (every ${pluginConfig.heartbeatIntervalSeconds}s)`);
        }
        // Register Matrix event handler for config updates
        // Try multiple API styles for backwards compat (Clawdbot + OpenClaw)
        if (api.registerMatrixEventHandler) {
            api.registerMatrixEventHandler("ai.krill.config.update", handleConfigUpdate);
            api.logger.info(`[krill-update] 📡 Registered handler for ai.krill.config.update`);
        }
        else if (api.on) {
            api.on("matrix.event", (evt) => {
                if (evt?.type === "ai.krill.config.update")
                    handleConfigUpdate(evt);
            });
            api.logger.info(`[krill-update] 📡 Registered handler via api.on for ai.krill.config.update`);
        }
        else {
            api.logger.info(`[krill-update] ℹ️ Matrix event handler not available (config updates via API polling only)`);
        }
        // Start periodic check
        if (pluginConfig.checkIntervalMinutes > 0) {
            checkInterval = setInterval(checkForUpdates, pluginConfig.checkIntervalMinutes * 60 * 1000);
            // Initial check after 60 seconds (give time for other plugins to load)
            setTimeout(checkForUpdates, 60000);
        }
        // Register CLI commands
        api.registerCli?.(({ program }) => {
            const update = program
                .command("krill-update")
                .description("Krill plugin update commands");
            update
                .command("check")
                .description("Check for plugin updates now")
                .action(async () => {
                await checkForUpdates();
            });
            update
                .command("list")
                .description("List installed Krill plugins")
                .action(() => {
                console.log("\n🦐 Installed Krill plugins:");
                for (const [name, version] of installedPlugins) {
                    console.log(`   ${name}: v${version}`);
                }
                console.log("");
            });
            update
                .command("status")
                .description("Show update plugin status")
                .action(() => {
                console.log(`\n🔄 Krill Update Plugin Status`);
                console.log(`   API: ${pluginConfig.apiUrl}`);
                console.log(`   Auto-update: ${pluginConfig.autoUpdate}`);
                console.log(`   Check interval: ${pluginConfig.checkIntervalMinutes} min`);
                console.log(`   Next check: ${checkInterval ? "scheduled" : "disabled"}`);
                console.log(`   Installed plugins: ${installedPlugins.size}`);
                console.log("");
            });
        }, { commands: ["krill-update"] });
    },
    unload() {
        if (checkInterval) {
            clearInterval(checkInterval);
            checkInterval = null;
        }
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        pluginApi?.logger.info(`[krill-update] Plugin unloaded`);
    },
};
export default plugin;
