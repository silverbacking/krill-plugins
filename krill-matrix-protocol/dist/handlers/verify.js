"use strict";
/**
 * Verification Handler
 *
 * Handles ai.krill.verify.* messages for agent verification.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleVerify = void 0;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Generate HMAC verification hash
 */
function generateHash(secret, agentMxid, gatewayId, enrolledAt) {
    const message = `${agentMxid}|${gatewayId}|${enrolledAt}`;
    return crypto_1.default.createHmac("sha256", secret).update(message).digest("hex");
}
exports.handleVerify = {
    /**
     * Handle ai.krill.verify.request
     */
    async request(config, content, sendResponse) {
        const agent = config.agent;
        if (!agent) {
            await sendResponse(JSON.stringify({
                type: "ai.krill.verify.response",
                content: {
                    verified: false,
                    error: "Agent not configured",
                },
            }));
            return;
        }
        const response = {
            type: "ai.krill.verify.response",
            content: {
                challenge: content.challenge,
                verified: true,
                agent: {
                    mxid: agent.mxid,
                    display_name: agent.displayName,
                    gateway_id: config.gatewayId,
                    capabilities: agent.capabilities || ["chat"],
                    status: "online",
                },
                responded_at: Math.floor(Date.now() / 1000),
            },
        };
        console.log(`[krill-verify] Verified: ${agent.mxid}`);
        await sendResponse(JSON.stringify(response));
    },
    /**
     * Verify an enrollment hash
     */
    verifyHash(config, agentMxid, gatewayId, enrolledAt, hash) {
        if (gatewayId !== config.gatewayId) {
            return false;
        }
        const expected = generateHash(config.gatewaySecret, agentMxid, gatewayId, enrolledAt);
        return hash === expected;
    },
};
