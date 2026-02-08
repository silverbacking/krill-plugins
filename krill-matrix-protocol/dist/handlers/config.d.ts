/**
 * Config Update Handler
 *
 * Handles ai.krill.config.update messages from the Krill API.
 * Applies config patches to openclaw.json with backup and rollback.
 */
export interface ConfigUpdateContent {
    request_id?: string;
    gateway_id?: string;
    config_patch: Record<string, any>;
    restart?: boolean;
    requested_by?: string;
    timestamp?: number;
}
export interface ConfigHandlerOptions {
    configPath?: string;
    allowedConfigSenders: string[];
    restartCommand?: string;
    healthCheckTimeoutSeconds?: number;
    sendResponse: (roomId: string, content: any) => Promise<void>;
    logger: {
        info: (msg: string) => void;
        warn: (msg: string) => void;
        error?: (msg: string) => void;
    };
}
export declare function initConfigHandler(opts: ConfigHandlerOptions): void;
/**
 * Handle ai.krill.config.update message
 */
export declare function handleConfig(event: {
    sender: string;
    room_id: string;
    event_id: string;
    content: ConfigUpdateContent;
}): Promise<boolean>;
