/**
 * Verification Handler
 * 
 * Handles ai.krill.verify.* messages for agent verification.
 */

import crypto from "crypto";
import type { KrillProtocolConfig } from "../index.js";

/**
 * Generate HMAC verification hash
 */
function generateHash(
  secret: string,
  agentMxid: string,
  gatewayId: string,
  enrolledAt: number
): string {
  const message = `${agentMxid}|${gatewayId}|${enrolledAt}`;
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

export const handleVerify = {
  /**
   * Handle ai.krill.verify.request
   */
  async request(
    config: KrillProtocolConfig,
    content: { challenge: string; timestamp?: number },
    sendResponse: (text: string) => Promise<void>
  ): Promise<void> {
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
  verifyHash(
    config: KrillProtocolConfig,
    agentMxid: string,
    gatewayId: string,
    enrolledAt: number,
    hash: string
  ): boolean {
    if (gatewayId !== config.gatewayId) {
      return false;
    }
    const expected = generateHash(config.gatewaySecret, agentMxid, gatewayId, enrolledAt);
    return hash === expected;
  },
};
