/**
 * Health Check Handler
 *
 * Handles ai.krill.health.* messages for agent health monitoring.
 *
 * States:
 * - online: Gateway responds AND LLM works
 * - unresponsive: Gateway responds BUT LLM timeout/error
 * - offline: No response (detected by monitor timeout)
 */
import type { KrillProtocolConfig } from "../index.js";
/**
 * Mark LLM as active (called when non-protocol message is received)
 */
export declare function markLlmActivity(): void;
export declare const handleHealth: {
    /**
     * Handle ai.krill.health.ping
     */
    ping(config: KrillProtocolConfig, content: {
        request_id: string;
        timestamp: number;
        skip_llm_test?: boolean;
    }, sendResponse: (text: string) => Promise<void>): Promise<void>;
};
