/**
 * Pairing Handler
 *
 * Handles ai.krill.pair.* messages for device-agent pairing.
 */
import type { KrillProtocolConfig } from "../index.js";
export interface PairingConfig {
    storagePath?: string;
}
interface Pairing {
    pairing_id: string;
    pairing_token_hash: string;
    agent_mxid: string;
    user_mxid: string;
    device_id: string;
    device_name: string;
    created_at: number;
    last_seen_at: number;
}
export declare const handlePairing: {
    /**
     * Handle ai.krill.pair.request
     */
    request(config: KrillProtocolConfig, content: {
        device_id: string;
        device_name: string;
        timestamp: number;
    }, senderId: string, sendResponse: (text: string) => Promise<void>): Promise<void>;
    /**
     * Validate a pairing token
     */
    validateToken(config: KrillProtocolConfig, token: string): Pairing | null;
};
export {};
