/**
 * Pairing Handler
 *
 * Handles ai.krill.pair.* messages for device-agent pairing.
 */
import crypto from "crypto";
import fs from "fs";
// In-memory store (persisted to disk)
let pairingsStore = { pairings: {} };
function getStoragePath(config) {
    return config.storagePath || "/tmp/krill-pairings.json";
}
function loadPairings(config) {
    try {
        const path = getStoragePath(config);
        if (fs.existsSync(path)) {
            pairingsStore = JSON.parse(fs.readFileSync(path, "utf-8"));
        }
    }
    catch {
        pairingsStore = { pairings: {} };
    }
}
function savePairings(config) {
    try {
        fs.writeFileSync(getStoragePath(config), JSON.stringify(pairingsStore, null, 2));
    }
    catch (e) {
        console.error("[krill-pairing] Failed to save:", e);
    }
}
function generateToken() {
    return `krill_tk_v1_${crypto.randomBytes(32).toString("base64url")}`;
}
function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}
export const handlePairing = {
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
        const pairing_id = `pair_${crypto.randomBytes(8).toString("hex")}`;
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
