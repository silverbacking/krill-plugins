/**
 * Krill Matrix Protocol Plugin
 *
 * Universal interceptor for all ai.krill.* messages.
 * Handles: pairing, verification, health checks, and future protocol extensions.
 *
 * This plugin intercepts Matrix messages BEFORE they reach the LLM,
 * responding automatically to protocol messages.
 */
import fs from "fs";
import path from "path";
// Import handlers
import { handlePairing } from "./handlers/pairing.js";
import { handleVerify } from "./handlers/verify.js";
import { handleHealth, markLlmActivity } from "./handlers/health.js";
// Plugin config schema
const configSchema = {
    type: "object",
    properties: {
        gatewayId: {
            type: "string",
            description: "Unique identifier for this gateway",
        },
        gatewaySecret: {
            type: "string",
            description: "Secret key for verification",
        },
        storagePath: {
            type: "string",
            description: "Path to store pairings and state",
        },
        agent: {
            type: "object",
            properties: {
                mxid: { type: "string" },
                displayName: { type: "string" },
                description: { type: "string" },
                capabilities: { type: "array", items: { type: "string" } },
            },
            required: ["mxid", "displayName"],
        },
    },
    required: ["gatewayId", "gatewaySecret"],
};
// Shared state
let pluginConfig = null;
let pluginApi = null;
/**
 * Parse ai.krill message from text
 */
function parseKrillMessage(text) {
    try {
        const parsed = JSON.parse(text);
        if (parsed.type?.startsWith("ai.krill.")) {
            return parsed;
        }
    }
    catch {
        // Not JSON or not a Krill message
    }
    return null;
}
/**
 * Message interceptor - handles all ai.krill.* messages
 * Returns response text if handled, null if message should pass to LLM
 */
async function handleKrillMessage(message, senderId, roomId, sendResponse) {
    const { type, content } = message;
    pluginApi?.logger.info(`[krill-protocol] Received: ${type}`);
    switch (type) {
        // === PAIRING ===
        case "ai.krill.pair.request":
            await handlePairing.request(pluginConfig, content, senderId, sendResponse);
            return true;
        // === VERIFICATION ===
        case "ai.krill.verify.request":
            await handleVerify.request(pluginConfig, content, sendResponse);
            return true;
        // === HEALTH CHECK ===
        case "ai.krill.health.ping":
            await handleHealth.ping(pluginConfig, content, sendResponse);
            return true;
        // === FUTURE PROTOCOL MESSAGES ===
        // Add new handlers here as the protocol evolves
        default:
            // Unknown ai.krill message - log but let it pass
            pluginApi?.logger.warn(`[krill-protocol] Unknown message type: ${type}`);
            return false;
    }
}
const plugin = {
    id: "krill-matrix-protocol",
    name: "Krill Matrix Protocol",
    description: "Handles all ai.krill.* protocol messages (pairing, verify, health)",
    configSchema,
    register(api) {
        pluginApi = api;
        // Get plugin config
        const config = api.config?.plugins?.entries?.["krill-matrix-protocol"]?.config;
        if (!config) {
            api.logger.warn("[krill-protocol] No config found, plugin disabled");
            return;
        }
        pluginConfig = config;
        api.logger.info(`[krill-protocol] Loaded for gateway: ${config.gatewayId}`);
        // Initialize storage
        if (config.storagePath) {
            const dir = path.dirname(config.storagePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
        // Register message interceptor
        // This intercepts messages BEFORE they reach the LLM
        api.registerMessageInterceptor?.(async (ctx) => {
            const text = ctx.message?.text || ctx.message?.body || "";
            const krillMsg = parseKrillMessage(text);
            if (!krillMsg) {
                // Not a Krill message - mark LLM activity and pass through
                markLlmActivity(); // Any non-protocol message = LLM is active
                return { handled: false };
            }
            // Handle the Krill message
            const sendResponse = async (responseText) => {
                await ctx.reply?.(responseText);
            };
            const handled = await handleKrillMessage(krillMsg, ctx.senderId || "", ctx.roomId || "", sendResponse);
            return { handled };
        });
        // Register HTTP endpoints for backwards compatibility
        api.registerHttpHandler(async (req, res) => {
            const url = new URL(req.url ?? "/", "http://localhost");
            if (!url.pathname.startsWith("/krill/")) {
                return false;
            }
            // Handle HTTP endpoints (for non-Matrix clients)
            // POST /krill/pair, /krill/verify, etc.
            return false; // Not handled via HTTP for now
        });
        api.logger.info("[krill-protocol] ✅ Protocol handler registered");
    },
};
export default plugin;
