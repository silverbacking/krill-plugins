/**
 * Krill Update Plugin
 *
 * Auto-update system for Krill Network gateways.
 * Uses API polling only (scalable for high volume of agents).
 *
 * NEW: Remote config updates via ai.krill.config.update Matrix messages
 * with automatic rollback if gateway fails to start.
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
    registerMatrixEventHandler?: (eventType: string, handler: (event: MatrixEvent) => Promise<boolean | void>) => void;
    sendMatrixMessage?: (roomId: string, content: any) => Promise<void>;
}
interface MatrixEvent {
    type: string;
    room_id: string;
    sender: string;
    content: any;
    event_id: string;
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
            configPath: {
                type: string;
                description: string;
                default: string;
            };
            restartCommand: {
                type: string;
                description: string;
                default: string;
            };
            healthCheckTimeoutSeconds: {
                type: string;
                description: string;
                default: number;
            };
            allowedConfigSenders: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
                default: any[];
            };
        };
    };
    register(api: ClawdbotPluginApi): Promise<void>;
    unload(): void;
};
export default plugin;
