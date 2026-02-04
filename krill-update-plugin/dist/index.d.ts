/**
 * Krill Update Plugin
 *
 * Auto-update system for Krill Network gateways.
 * Uses API polling only (scalable for high volume of agents).
 *
 * Depends on: krill-agent-init (for gatewayId/gatewaySecret)
 */
interface ClawdbotPluginApi {
    config?: any;
    logger: {
        info: (msg: string) => void;
        warn: (msg: string) => void;
        error?: (msg: string) => void;
    };
    registerCli?: (fn: (ctx: {
        program: any;
    }) => void, opts?: {
        commands: string[];
    }) => void;
}
declare const plugin: {
    id: string;
    name: string;
    description: string;
    configSchema: {
        type: string;
        properties: {
            apiUrl: {
                type: string;
                description: string;
                default: string;
            };
            autoUpdate: {
                type: string;
                description: string;
                default: boolean;
            };
            checkIntervalMinutes: {
                type: string;
                description: string;
                default: number;
            };
        };
    };
    register(api: ClawdbotPluginApi): Promise<void>;
    unload(): void;
};
export default plugin;
