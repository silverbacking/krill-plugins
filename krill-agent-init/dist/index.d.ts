/**
 * Krill Agent Init Plugin
 *
 * Handles one-time agent enrollment to the Krill Network:
 * 1. Creates Matrix user (if needed)
 * 2. Joins the registry room
 * 3. Publishes ai.krill.agent state event
 * 4. Registers with the Krill API
 *
 * This plugin runs once on startup and ensures the agent is enrolled.
 */
import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
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
            registryRoomId: {
                type: string;
                description: string;
            };
            krillApiUrl: {
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
        required: string[];
    };
    register(api: ClawdbotPluginApi): void;
};
export default plugin;
