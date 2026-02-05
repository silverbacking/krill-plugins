/**
 * Krill Agent Init Plugin
 *
 * Handles agent enrollment to the Krill Network on boot:
 *   1. Joins the registry room
 *   2. Publishes ai.krill.agent state event
 *   3. Registers gateway with Krill API
 *
 * Provisioning (creating Matrix user, getting credentials) is handled
 * by the setup scripts BEFORE the gateway starts. This plugin only
 * does enrollment with existing credentials.
 */
import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
declare const plugin: {
    id: string;
    name: string;
    description: string;
    configSchema: {
        type: string;
        properties: {
            agentName: {
                type: string;
                description: string;
            };
            displayName: {
                type: string;
                description: string;
            };
            description: {
                type: string;
                description: string;
            };
            capabilities: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            model: {
                type: string;
                description: string;
            };
            krillApiUrl: {
                type: string;
                description: string;
            };
            krillApiKey: {
                type: string;
                description: string;
            };
            registryRoomId: {
                type: string;
                description: string;
            };
            gatewayId: {
                type: string;
                description: string;
            };
            gatewaySecret: {
                type: string;
                description: string;
            };
            agent: {
                type: string;
                description: string;
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
