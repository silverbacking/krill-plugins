/**
 * Krill Matrix Protocol Plugin
 *
 * Universal interceptor for all ai.krill.* messages.
 * Handles: pairing, verification, health checks, and future protocol extensions.
 *
 * This plugin intercepts Matrix messages BEFORE they reach the LLM,
 * responding automatically to protocol messages.
 */
import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
export interface KrillProtocolConfig {
    gatewayId: string;
    gatewaySecret: string;
    storagePath?: string;
    agent?: {
        mxid: string;
        displayName: string;
        description?: string;
        capabilities?: string[];
    };
}
declare const plugin: {
    id: string;
    name: string;
    description: string;
    configSchema: {
        type: string;
        properties: {
            gatewayId: {
                type: string;
                description: string;
            };
            gatewaySecret: {
                type: string;
                description: string;
            };
            storagePath: {
                type: string;
                description: string;
            };
            agent: {
                type: string;
                properties: {
                    mxid: {
                        type: string;
                    };
                    displayName: {
                        type: string;
                    };
                    description: {
                        type: string;
                    };
                    capabilities: {
                        type: string;
                        items: {
                            type: string;
                        };
                    };
                };
                required: string[];
            };
        };
        required: any[];
    };
    register(api: ClawdbotPluginApi): void;
};
export default plugin;
