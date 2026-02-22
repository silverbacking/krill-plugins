/**
 * Krill Agent Init Plugin
 *
 * Handles agent enrollment to the Krill Network on boot:
 *   1. Joins the registry room
 *   2. Publishes ai.krill.agent state event
 *   3. Registers gateway with Krill API
 *
 * Provisioning (creating Matrix user, getting credentials) is handled
 * by the setup scripts BEFORE the gateway starts. This plugin only
 * does enrollment with existing credentials.
 */
import crypto from "crypto";
// ── Config Schema ────────────────────────────────────────────────────
const configSchema = {
    type: "object",
    properties: {
        agentName: {
            type: "string",
            description: "Agent username (lowercase, alphanumeric)",
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
        gatewayId: {
            type: "string",
            description: "Gateway ID (set by setup script)",
        },
        gatewaySecret: {
            type: "string",
            description: "Gateway secret (set by setup script)",
        },
        agent: {
            type: "object",
            description: "Agent identity (set by setup script)",
            properties: {
                mxid: { type: "string" },
                displayName: { type: "string" },
                description: { type: "string" },
                capabilities: { type: "array", items: { type: "string" } },
            },
            required: ["mxid", "displayName"],
        },
    },
    required: ["gatewayId", "gatewaySecret", "agent"],
};
// ── Helpers ──────────────────────────────────────────────────────────
function generateVerificationHash(secret, agentMxid, gatewayId, enrolledAt) {
    const message = `${agentMxid}|${gatewayId}|${enrolledAt}`;
    return crypto.createHmac("sha256", secret).update(message).digest("hex");
}
/**
 * Enroll agent in the registry room via Matrix state event.
 */
async function enrollInRegistry(api, config, matrixHomeserver, accessToken) {
    const { agent, gatewayId, gatewaySecret, registryRoomId } = config;
    if (!registryRoomId) {
        api.logger.info("[krill-init] No registry room configured — skipping");
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
        const stateRes = await fetch(`${matrixHomeserver}/_matrix/client/v3/rooms/${encodeURIComponent(registryRoomId)}/state/ai.krill.agent/${encodeURIComponent(agent.mxid)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (stateRes.ok) {
            const existing = (await stateRes.json());
            if (existing.gateway_id === gatewayId) {
                api.logger.info(`[krill-init] ✅ Already enrolled: ${agent.mxid}`);
                return true;
            }
        }
        // Publish enrollment state event
        const enrolledAt = Math.floor(Date.now() / 1000);
        const verificationHash = generateVerificationHash(gatewaySecret, agent.mxid, gatewayId, enrolledAt);
        const stateContent = {
            gateway_id: gatewayId,
            display_name: agent.displayName,
            description: agent.description || config.description || `${agent.displayName} - Krill Network Agent`,
            capabilities: agent.capabilities || config.capabilities || ["chat"],
            enrolled_at: enrolledAt,
            verification_hash: verificationHash,
        };
        const enrollRes = await fetch(`${matrixHomeserver}/_matrix/client/v3/rooms/${encodeURIComponent(registryRoomId)}/state/ai.krill.agent/${encodeURIComponent(agent.mxid)}`, {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(stateContent),
        });
        if (enrollRes.ok) {
            api.logger.info(`[krill-init] ✅ Enrolled in registry: ${agent.mxid}`);
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
    if (!krillApiUrl)
        return false;
    try {
        const res = await fetch(`${krillApiUrl}/v1/gateways/register`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-gateway-id": gatewayId,
                "x-gateway-secret": gatewaySecret,
            },
            body: JSON.stringify({
                serverIp: "0.0.0.0",
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
/**
 * Ensure the gateway owner's Matrix ID is in ownerNumbers config.
 * Looks up owner_id from the Krill API, gets their MXID, and adds
 * it to the local OpenClaw config if missing.
 */
async function ensureOwnerInConfig(api, config, matrixConfig) {
    const { krillApiUrl, gatewayId, gatewaySecret } = config;
    try {
        // Get gateway info including owner_id
        const gwRes = await fetch(`${krillApiUrl}/v1/gateways/checkin`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-gateway-id": gatewayId,
                "x-gateway-secret": gatewaySecret,
            },
            body: JSON.stringify({ gateway_id: gatewayId }),
        });
        if (!gwRes.ok) return;
        const gwData = await gwRes.json();
        const ownerId = gwData.owner_id || gwData.gateway?.owner_id;
        if (!ownerId) {
            api.logger.info("[krill-init] No owner_id on gateway — skipping ownerNumbers sync");
            return;
        }
        // Get owner's MXID from the users API
        const ownerRes = await fetch(`${krillApiUrl}/v1/auth/profile?userId=${encodeURIComponent(ownerId)}`);
        if (!ownerRes.ok) return;
        const ownerData = await ownerRes.json();
        const ownerMxid = ownerData.matrixId || ownerData.matrix_id;
        if (!ownerMxid) {
            api.logger.info("[krill-init] Owner has no MXID — skipping ownerNumbers sync");
            return;
        }
        // Check if already in ownerNumbers
        const currentOwners = matrixConfig?.ownerNumbers || [];
        if (currentOwners.includes(ownerMxid)) {
            api.logger.info(`[krill-init] Owner ${ownerMxid} already in ownerNumbers`);
            return;
        }
        // Find and update config file
        const fs = await import("fs");
        const path = await import("path");
        const configPaths = [
            path.join(process.env.HOME || "", ".openclaw", "openclaw.json"),
            path.join(process.env.HOME || "", ".openclaw", "openclaw.yaml"),
            path.join(process.env.HOME || "", ".clawdbot", "clawdbot.yaml"),
        ];
        for (const cfgPath of configPaths) {
            if (!fs.existsSync(cfgPath)) continue;
            if (cfgPath.endsWith(".json")) {
                const raw = fs.readFileSync(cfgPath, "utf-8");
                const cfg = JSON.parse(raw);
                if (!cfg.channels?.matrix?.ownerNumbers) {
                    if (!cfg.channels) cfg.channels = {};
                    if (!cfg.channels.matrix) cfg.channels.matrix = {};
                    cfg.channels.matrix.ownerNumbers = [];
                }
                if (!cfg.channels.matrix.ownerNumbers.includes(ownerMxid)) {
                    cfg.channels.matrix.ownerNumbers.push(ownerMxid);
                    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
                    api.logger.info(`[krill-init] ✅ Added owner ${ownerMxid} to ownerNumbers in ${cfgPath}`);
                    api.logger.info(`[krill-init] ⚠️ Gateway restart needed for ownerNumbers to take effect`);
                }
                return;
            }
            // YAML support (basic — append to ownerNumbers list)
            if (cfgPath.endsWith(".yaml") || cfgPath.endsWith(".yml")) {
                const raw = fs.readFileSync(cfgPath, "utf-8");
                if (!raw.includes(ownerMxid)) {
                    // Find ownerNumbers section and append
                    const lines = raw.split("\n");
                    let inserted = false;
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].includes("ownerNumbers:")) {
                            // Find the last - entry under ownerNumbers
                            let j = i + 1;
                            while (j < lines.length && lines[j].match(/^\s+-\s/)) j++;
                            const indent = lines[i + 1]?.match(/^(\s+)/)?.[1] || "        ";
                            lines.splice(j, 0, `${indent}- "${ownerMxid}"`);
                            inserted = true;
                            break;
                        }
                    }
                    if (inserted) {
                        fs.writeFileSync(cfgPath, lines.join("\n"));
                        api.logger.info(`[krill-init] ✅ Added owner ${ownerMxid} to ownerNumbers in ${cfgPath}`);
                    }
                }
                return;
            }
        }
    }
    catch (error) {
        api.logger.warn(`[krill-init] Owner sync error: ${error.message}`);
    }
}
// ── Plugin ───────────────────────────────────────────────────────────
const plugin = {
    id: "krill-agent-init",
    name: "Krill Agent Init",
    description: "Enrollment of agents to the Krill Network",
    configSchema,
    register(api) {
        const config = api.config?.plugins?.entries?.["krill-agent-init"]?.config;
        if (!config) {
            api.logger.warn("[krill-init] No config found, plugin disabled");
            return;
        }
        api.logger.info(`[krill-init] Initializing: "${config.agent.displayName}" (${config.agent.mxid})`);
        const matrixConfig = api.config?.channels?.matrix;
        // Schedule enrollment after Matrix connects
        setTimeout(async () => {
            // Register gateway with API
            if (config.krillApiUrl) {
                await registerGateway(api, config);
            }
            // Enroll in registry room
            if (matrixConfig?.homeserver && matrixConfig?.accessToken && config.registryRoomId) {
                await enrollInRegistry(api, config, matrixConfig.homeserver, matrixConfig.accessToken);
            }
            // Ensure gateway owner's MXID is in ownerNumbers
            if (config.krillApiUrl && config.gatewayId) {
                await ensureOwnerInConfig(api, config, matrixConfig);
            }
            api.logger.info("[krill-init] ✅ Init complete");
        }, 10000);
    },
};
export default plugin;
