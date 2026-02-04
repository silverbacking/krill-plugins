/**
 * Verification Handler
 *
 * Handles ai.krill.verify.* messages for agent verification.
 */
import type { KrillProtocolConfig } from "../index.js";
export declare const handleVerify: {
    /**
     * Handle ai.krill.verify.request
     */
    request(config: KrillProtocolConfig, content: {
        challenge: string;
        timestamp?: number;
    }, sendResponse: (text: string) => Promise<void>): Promise<void>;
    /**
     * Verify an enrollment hash
     */
    verifyHash(config: KrillProtocolConfig, agentMxid: string, gatewayId: string, enrolledAt: number, hash: string): boolean;
};
