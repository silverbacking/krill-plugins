/**
 * Krill Agent Init Plugin
 *
 * Registers the gateway with the Krill API on startup via check-in.
 * Collects system info (OS, arch, hostname, Node version, OpenClaw version, plugins).
 *
 * Provisioning (creating Matrix user, getting credentials) is handled
 * by setup-gateway-node.sh BEFORE the gateway starts.
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
            krillApiUrl: {
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
                };
                required: string[];
            };
        };
        required: string[];
    };
    register(api: ClawdbotPluginApi): void;
};
export default plugin;
