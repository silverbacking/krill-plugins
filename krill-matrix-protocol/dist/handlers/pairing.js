"use strict";
/**
 * Pairing Handler
 *
 * Handles ai.krill.pair.* messages for device-agent pairing.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePairing = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
// In-memory store (persisted to disk)
let pairingsStore = { pairings: {} };
function getStoragePath(config) {
    return config.storagePath || "/tmp/krill-pairings.json";
}
function loadPairings(config) {
    try {
        const path = getStoragePath(config);
        if (fs_1.default.existsSync(path)) {
            pairingsStore = JSON.parse(fs_1.default.readFileSync(path, "utf-8"));
        }
    }
    catch {
        pairingsStore = { pairings: {} };
    }
}
function savePairings(config) {
    try {
        fs_1.default.writeFileSync(getStoragePath(config), JSON.stringify(pairingsStore, null, 2));
    }
    catch (e) {
        console.error("[krill-pairing] Failed to save:", e);
    }
}
function generateToken() {
    return `krill_tk_v1_${crypto_1.default.randomBytes(32).toString("base64url")}`;
}
function hashToken(token) {
    return crypto_1.default.createHash("sha256").update(token).digest("hex");
}
exports.handlePairing = {
    /**
     * Handle ai.krill.pair.request
     */
    async request(config, content, senderId, sendResponse) {
        loadPairings(config);
        const { device_id, device_name } = content;
        const agent = config.agent;
        if (!agent) {
            await sendResponse(JSON.stringify({
                type: "ai.krill.pair.response",
                content: {
                    success: false,
                    error: "Agent not configured",
                },
            }));
            return;
        }
        // Check if already paired
        const existingKey = `${senderId}:${device_id}`;
        const existing = pairingsStore.pairings[existingKey];
        if (existing) {
            // Update last seen
            existing.last_seen_at = Date.now();
            savePairings(config);
            // Don't reveal existing token, just confirm
            await sendResponse(JSON.stringify({
                type: "ai.krill.pair.response",
                content: {
                    success: true,
                    pairing_id: existing.pairing_id,
                    agent: {
                        mxid: agent.mxid,
                        display_name: agent.displayName,
                        capabilities: agent.capabilities || ["chat"],
                    },
                    message: "Ja estem connectats! 👋",
                },
            }));
            return;
        }
        // Create new pairing
        const pairing_id = `pair_${crypto_1.default.randomBytes(8).toString("hex")}`;
        const pairing_token = generateToken();
        const pairing = {
            pairing_id,
            pairing_token_hash: hashToken(pairing_token),
            agent_mxid: agent.mxid,
            user_mxid: senderId,
            device_id,
            device_name,
            created_at: Date.now(),
            last_seen_at: Date.now(),
        };
        pairingsStore.pairings[existingKey] = pairing;
        savePairings(config);
        console.log(`[krill-pairing] New pairing: ${pairing_id} for ${senderId}`);
        await sendResponse(JSON.stringify({
            type: "ai.krill.pair.response",
            content: {
                success: true,
                pairing_id,
                pairing_token,
                agent: {
                    mxid: agent.mxid,
                    display_name: agent.displayName,
                    capabilities: agent.capabilities || ["chat"],
                },
                created_at: pairing.created_at,
                message: "Hola! Ara estem connectats. 🦐",
            },
        }));
    },
    /**
     * Validate a pairing token
     */
    validateToken(config, token) {
        loadPairings(config);
        const hash = hashToken(token);
        for (const pairing of Object.values(pairingsStore.pairings)) {
            if (pairing.pairing_token_hash === hash) {
                pairing.last_seen_at = Date.now();
                savePairings(config);
                return pairing;
            }
        }
        return null;
    },
};
