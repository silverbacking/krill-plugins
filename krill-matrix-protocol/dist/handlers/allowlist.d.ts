/**
 * Allowlist Handler
 *
 * Manages the OpenClaw allowFrom list for agents.
 * Used when users hire/unhire agents via Krill Network.
 *
 * Message format:
 * {
 *   "type": "ai.krill.allowlist",
 *   "content": {
 *     "action": "add" | "remove",
 *     "mxid": "@user:matrix.krillbot.network",
 *     "reason": "hire" | "unhire" | "owner" | "manual",
 *     "contractId": "optional-contract-id"
 *   }
 * }
 */
interface AllowlistContent {
    action: "add" | "remove";
    mxid: string;
    reason?: "hire" | "unhire" | "owner" | "manual";
    contractId?: string;
}
interface AllowlistConfig {
    configPath?: string;
    allowedSenders?: string[];
    logger?: any;
}
/**
 * Initialize the allowlist handler
 */
export declare function initAllowlistHandler(config: AllowlistConfig): void;
/**
 * Handle ai.krill.allowlist message
 */
export declare function handleAllowlist(content: AllowlistContent, senderId: string, sendResponse: (text: string) => Promise<void>): Promise<void>;
declare const _default: {
    handle: typeof handleAllowlist;
    init: typeof initAllowlistHandler;
};
export default _default;
