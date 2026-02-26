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
import fs from "fs";
import path from "path";
let handlerConfig = {};
/**
 * Initialize the allowlist handler
 */
export function initAllowlistHandler(config) {
    handlerConfig = config;
    handlerConfig.logger?.info("[allowlist] Handler initialized");
}
/**
 * Get the OpenClaw config path
 */
function getConfigPath() {
    return handlerConfig.configPath ||
        path.join(process.env.HOME || "", ".openclaw", "openclaw.json");
}
/**
 * Read current OpenClaw config
 */
function readConfig() {
    const configPath = getConfigPath();
    try {
        const content = fs.readFileSync(configPath, "utf-8");
        return JSON.parse(content);
    }
    catch (error) {
        handlerConfig.logger?.error(`[allowlist] Failed to read config: ${error}`);
        return null;
    }
}
/**
 * Write OpenClaw config (triggers hot-reload)
 */
function writeConfig(config) {
    const configPath = getConfigPath();
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        handlerConfig.logger?.info("[allowlist] Config updated (hot-reload will apply changes)");
        return true;
    }
    catch (error) {
        handlerConfig.logger?.error(`[allowlist] Failed to write config: ${error}`);
        return false;
    }
}
/**
 * Get current allowFrom list for Matrix channel
 */
function getAllowlist(config) {
    return config?.channels?.matrix?.allowFrom || [];
}
/**
 * Update allowFrom list in config
 */
function setAllowlist(config, allowlist) {
    if (!config.channels)
        config.channels = {};
    if (!config.channels.matrix)
        config.channels.matrix = {};
    config.channels.matrix.allowFrom = allowlist;
    config.channels.matrix.dmPolicy = "allowlist"; // Ensure dmPolicy is set
    return config;
}
/**
 * Handle ai.krill.allowlist message
 */
export async function handleAllowlist(content, senderId, sendResponse) {
    const { action, mxid, reason, contractId } = content;
    handlerConfig.logger?.info(`[allowlist] ${action} ${mxid} from ${senderId} (reason: ${reason || "none"})`);
    // Validate sender (only trusted sources can modify allowlist)
    const allowedSenders = handlerConfig.allowedSenders || [];
    const isAllowed = allowedSenders.length === 0 || allowedSenders.includes(senderId);
    if (!isAllowed) {
        handlerConfig.logger?.warn(`[allowlist] Unauthorized sender: ${senderId}`);
        const response = {
            type: "ai.krill.allowlist.response",
            content: {
                success: false,
                action,
                mxid,
                error: "UNAUTHORIZED_SENDER",
                timestamp: Math.floor(Date.now() / 1000),
            },
        };
        await sendResponse(JSON.stringify(response));
        return;
    }
    // Validate MXID format
    if (!mxid || !mxid.startsWith("@") || !mxid.includes(":")) {
        const response = {
            type: "ai.krill.allowlist.response",
            content: {
                success: false,
                action,
                mxid,
                error: "INVALID_MXID",
                timestamp: Math.floor(Date.now() / 1000),
            },
        };
        await sendResponse(JSON.stringify(response));
        return;
    }
    // Read current config
    const config = readConfig();
    if (!config) {
        const response = {
            type: "ai.krill.allowlist.response",
            content: {
                success: false,
                action,
                mxid,
                error: "CONFIG_READ_ERROR",
                timestamp: Math.floor(Date.now() / 1000),
            },
        };
        await sendResponse(JSON.stringify(response));
        return;
    }
    // Get current allowlist
    let allowlist = getAllowlist(config);
    // Perform action
    if (action === "add") {
        if (!allowlist.includes(mxid)) {
            allowlist.push(mxid);
            handlerConfig.logger?.info(`[allowlist] Added ${mxid} to allowlist`);
        }
        else {
            handlerConfig.logger?.info(`[allowlist] ${mxid} already in allowlist`);
        }
    }
    else if (action === "remove") {
        const index = allowlist.indexOf(mxid);
        if (index > -1) {
            allowlist.splice(index, 1);
            handlerConfig.logger?.info(`[allowlist] Removed ${mxid} from allowlist`);
        }
        else {
            handlerConfig.logger?.info(`[allowlist] ${mxid} not in allowlist`);
        }
    }
    else {
        const response = {
            type: "ai.krill.allowlist.response",
            content: {
                success: false,
                action,
                mxid,
                error: "INVALID_ACTION",
                timestamp: Math.floor(Date.now() / 1000),
            },
        };
        await sendResponse(JSON.stringify(response));
        return;
    }
    // Update config
    const updatedConfig = setAllowlist(config, allowlist);
    const success = writeConfig(updatedConfig);
    // Send response
    const response = {
        type: "ai.krill.allowlist.response",
        content: {
            success,
            action,
            mxid,
            allowlist: success ? allowlist : undefined,
            error: success ? undefined : "CONFIG_WRITE_ERROR",
            timestamp: Math.floor(Date.now() / 1000),
        },
    };
    await sendResponse(JSON.stringify(response));
    // Log contract info if provided
    if (contractId) {
        handlerConfig.logger?.info(`[allowlist] Contract: ${contractId} - ${action} ${mxid}`);
    }
}
export default {
    handle: handleAllowlist,
    init: initAllowlistHandler,
};
