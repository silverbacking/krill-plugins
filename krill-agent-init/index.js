/**
 * Krill Agent Init Plugin
 *
 * Handles agent provisioning and enrollment to the Krill Network:
 *
 * First boot (no credentials):
 *   1. Calls Krill API to provision Matrix user
 *   2. Stores credentials in clawdbot.json
 *   3. Triggers gateway restart to connect with new credentials
 *
 * Subsequent boots (has credentials):
 *   1. Joins the registry room
 *   2. Publishes ai.krill.agent state event
 *   3. Registers with Krill API
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
// ── Config Schema ────────────────────────────────────────────────────
const configSchema = {
    type: "object",
    properties: {
        agentName: {
            type: "string",
            description: "Desired agent username (lowercase, alphanumeric)",
        },
        displayName: {
            type: "string",
            description: "Human-readable display name",
        },
        description: {
            type: "string",
            description: "Short description of the agent",
        },
        capabilities: {
            type: "array",
            items: { type: "string" },
            description: "Agent capabilities (e.g., chat, senses)",
        },
        model: {
            type: "string",
            description: "LLM model identifier",
        },
        krillApiUrl: {
            type: "string",
            description: "Krill API URL (e.g., https://api.krillbot.network)",
        },
        krillApiKey: {
            type: "string",
            description: "API key for Krill API authentication",
        },
        registryRoomId: {
            type: "string",
            description: "Matrix room ID for agent registry (optional)",
        },
        // Legacy fields (used if credentials already exist)
        gatewayId: {
            type: "string",
            description: "Gateway ID (auto-generated if not set)",
        },
        gatewaySecret: {
            type: "string",
            description: "Gateway secret (auto-generated if not set)",
        },
        agent: {
            type: "object",
            description: "Legacy agent config (mxid, displayName)",
            properties: {
                mxid: { type: "string" },
                displayName: { type: "string" },
                description: { type: "string" },
                capabilities: { type: "array", items: { type: "string" } },
            },
        },
    },
    required: ["displayName", "krillApiUrl"],
};
// ── Helpers ──────────────────────────────────────────────────────────
function generateVerificationHash(secret, agentMxid, gatewayId, enrolledAt) {
    const message = `${agentMxid}|${gatewayId}|${enrolledAt}`;
    return crypto.createHmac("sha256", secret).update(message).digest("hex");
}
/**
 * Check if Matrix credentials exist in the config.
 */
function hasMatrixCredentials(api) {
    const matrixConfig = api.config?.channels?.matrix;
    return !!(matrixConfig?.accessToken && matrixConfig?.userId);
}
/**
 * Get the clawdbot.json path.
 */
function getConfigPath() {
    const home = process.env.HOME || "/home/carles";
    return path.join(home, ".clawdbot", "clawdbot.json");
}
/**
 * Call the Krill API to provision a new agent.
 */
async function provisionAgent(api, config) {
    const { krillApiUrl, krillApiKey, agentName, displayName, description, capabilities, model } = config;
    const headers = {
        "Content-Type": "application/json",
    };
    // Auth: API key or gateway credentials
    if (krillApiKey) {
        headers["x-api-key"] = krillApiKey;
    }
    else if (config.gatewayId && config.gatewaySecret) {
        headers["x-gateway-id"] = config.gatewayId;
        headers["x-gateway-secret"] = config.gatewaySecret;
    }
    const body = {
        agentName: agentName || displayName.toLowerCase().replace(/[^a-z0-9]/g, ""),
        displayName,
        description: description || `${displayName} - Krill Network Agent`,
        capabilities: capabilities || ["chat"],
        model: model || "unknown",
        isPublic: false,
    };
    api.logger.info(`[krill-init] Provisioning agent "${displayName}" via ${krillApiUrl}...`);
    try {
        const res = await fetch(`${krillApiUrl}/v1/provision/agent`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            api.logger.error(`[krill-init] Provisioning failed: ${res.status} - ${error.error?.code || "Unknown"}: ${error.error?.message || res.statusText}`);
            return null;
        }
        const result = (await res.json());
        api.logger.info(`[krill-init] ✅ Agent provisioned: ${result.agent.mxid}`);
        return result;
    }
    catch (error) {
        api.logger.error(`[krill-init] Provisioning request failed: ${error.message}`);
        return null;
    }
}
/**
 * Save provisioned credentials to clawdbot.json.
 */
function saveCredentials(api, provision) {
    const configPath = getConfigPath();
    try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const clawdbotConfig = JSON.parse(raw);
        // Set Matrix channel credentials
        if (!clawdbotConfig.channels)
            clawdbotConfig.channels = {};
        if (!clawdbotConfig.channels.matrix)
            clawdbotConfig.channels.matrix = {};
        clawdbotConfig.channels.matrix.enabled = true;
        clawdbotConfig.channels.matrix.homeserver = provision.credentials.homeserver;
        clawdbotConfig.channels.matrix.userId = provision.agent.mxid;
        clawdbotConfig.channels.matrix.accessToken = provision.credentials.accessToken;
        clawdbotConfig.channels.matrix.deviceName = provision.credentials.deviceId;
        // Update plugin config with provisioned values
        const pluginConfig = clawdbotConfig.plugins?.entries?.["krill-agent-init"]?.config;
        if (pluginConfig) {
            pluginConfig.gatewayId = provision.credentials.gatewayId;
            pluginConfig.gatewaySecret = provision.credentials.gatewaySecret;
            pluginConfig.agent = {
                mxid: provision.agent.mxid,
                displayName: provision.agent.displayName,
                description: provision.agent.description,
                capabilities: provision.agent.capabilities,
            };
        }
        // Also update krill-matrix-protocol if present
        const protocolConfig = clawdbotConfig.plugins?.entries?.["krill-matrix-protocol"]?.config;
        if (protocolConfig) {
            protocolConfig.gatewayId = provision.credentials.gatewayId;
            protocolConfig.gatewaySecret = provision.credentials.gatewaySecret;
            protocolConfig.agent = {
                mxid: provision.agent.mxid,
                displayName: provision.agent.displayName,
                capabilities: provision.agent.capabilities,
            };
        }
        fs.writeFileSync(configPath, JSON.stringify(clawdbotConfig, null, 2));
        api.logger.info(`[krill-init] ✅ Credentials saved to ${configPath}`);
        return true;
    }
    catch (error) {
        api.logger.error(`[krill-init] Failed to save credentials: ${error.message}`);
        return false;
    }
}
/**
 * Enroll agent in the registry room via Matrix state event.
 */
async function enrollInRegistry(api, config, matrixHomeserver, accessToken) {
    const agentMxid = config.agent?.mxid;
    const gatewayId = config.gatewayId;
    const gatewaySecret = config.gatewaySecret;
    const registryRoomId = config.registryRoomId;
    if (!registryRoomId || !agentMxid || !gatewayId || !gatewaySecret) {
        api.logger.info("[krill-init] Skipping registry enrollment (missing config)");
        return false;
    }
    try {
        // Join registry room
        api.logger.info(`[krill-init] Joining registry room ${registryRoomId}...`);
        await fetch(`${matrixHomeserver}/_matrix/client/v3/join/${encodeURIComponent(registryRoomId)}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: "{}",
        });
        // Check if already enrolled
        const stateRes = await fetch(`${matrixHomeserver}/_matrix/client/v3/rooms/${encodeURIComponent(registryRoomId)}/state/ai.krill.agent/${encodeURIComponent(agentMxid)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (stateRes.ok) {
            const existing = (await stateRes.json());
            if (existing.gateway_id === gatewayId) {
                api.logger.info(`[krill-init] ✅ Already enrolled: ${agentMxid}`);
                return true;
            }
        }
        // Publish enrollment state event
        const enrolledAt = Math.floor(Date.now() / 1000);
        const verificationHash = generateVerificationHash(gatewaySecret, agentMxid, gatewayId, enrolledAt);
        const stateContent = {
            gateway_id: gatewayId,
            display_name: config.agent?.displayName || config.displayName,
            description: config.agent?.description || config.description || `${config.displayName} - Krill Network Agent`,
            capabilities: config.agent?.capabilities || config.capabilities || ["chat"],
            enrolled_at: enrolledAt,
            verification_hash: verificationHash,
        };
        const enrollRes = await fetch(`${matrixHomeserver}/_matrix/client/v3/rooms/${encodeURIComponent(registryRoomId)}/state/ai.krill.agent/${encodeURIComponent(agentMxid)}`, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(stateContent),
        });
        if (enrollRes.ok) {
            api.logger.info(`[krill-init] ✅ Enrolled in registry: ${agentMxid}`);
            return true;
        }
        else {
            const error = await enrollRes.text();
            api.logger.warn(`[krill-init] Registry enrollment failed: ${error}`);
            return false;
        }
    }
    catch (error) {
        api.logger.warn(`[krill-init] Registry enrollment error: ${error.message}`);
        return false;
    }
}
/**
 * Register gateway with the Krill API.
 */
async function registerGateway(api, config) {
    const { gatewayId, gatewaySecret, krillApiUrl } = config;
    if (!krillApiUrl || !gatewayId || !gatewaySecret) {
        return false;
    }
    try {
        const publicKey = crypto.createHash("sha256").update(gatewaySecret).digest("hex");
        const res = await fetch(`${krillApiUrl}/v1/gateways/register`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-gateway-id": gatewayId,
                "x-gateway-secret": gatewaySecret,
            },
            body: JSON.stringify({
                serverIp: "0.0.0.0", // Will be detected by API
                version: "1.0.0",
                hostname: gatewayId,
            }),
        });
        if (res.ok) {
            api.logger.info(`[krill-init] ✅ Gateway registered: ${gatewayId}`);
            return true;
        }
    }
    catch (error) {
        api.logger.warn(`[krill-init] Gateway registration failed: ${error.message}`);
    }
    return false;
}
// ── Plugin ───────────────────────────────────────────────────────────
const plugin = {
    id: "krill-agent-init",
    name: "Krill Agent Init",
    description: "Auto-provisioning and enrollment of agents to the Krill Network",
    configSchema,
    register(api) {
        const config = api.config?.plugins?.entries?.["krill-agent-init"]?.config;
        if (!config) {
            api.logger.warn("[krill-init] No config found, plugin disabled");
            return;
        }
        api.logger.info(`[krill-init] Initializing: "${config.displayName}"`);
        // ── Phase 1: Check if we need provisioning ──
        if (!hasMatrixCredentials(api)) {
            api.logger.info("[krill-init] No Matrix credentials found — starting provisioning...");
            // Provision immediately (don't wait for Matrix — it's not connected yet!)
            (async () => {
                const result = await provisionAgent(api, config);
                if (!result) {
                    api.logger.error("[krill-init] ❌ Provisioning failed. Agent will not be available.");
                    return;
                }
                // Save credentials to clawdbot.json
                const saved = saveCredentials(api, result);
                if (!saved) {
                    api.logger.error("[krill-init] ❌ Failed to save credentials.");
                    return;
                }
                // Request gateway restart to pick up new Matrix credentials
                api.logger.info("[krill-init] 🔄 Credentials saved. Requesting gateway restart...");
                // Give the config write a moment to flush
                setTimeout(() => {
                    api.logger.info("[krill-init] Sending SIGUSR1 for config reload...");
                    process.kill(process.pid, "SIGUSR1");
                }, 2000);
            })();
            return; // Don't proceed to enrollment — will happen after restart
        }
        // ── Phase 2: Already have credentials — do enrollment ──
        api.logger.info("[krill-init] Matrix credentials found — scheduling enrollment...");
        const matrixConfig = api.config?.channels?.matrix;
        setTimeout(async () => {
            // Register gateway with API
            if (config.krillApiUrl && config.gatewayId) {
                await registerGateway(api, config);
            }
            // Enroll in registry room
            if (matrixConfig?.homeserver && matrixConfig?.accessToken) {
                await enrollInRegistry(api, config, matrixConfig.homeserver, matrixConfig.accessToken);
            }
            api.logger.info("[krill-init] ✅ Init complete");
        }, 10000); // Wait 10s for Matrix to connect
    },
};
export default plugin;
