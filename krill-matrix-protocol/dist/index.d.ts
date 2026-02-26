/**
 * Krill Matrix Protocol Plugin v1.2.0
 *
 * Universal interceptor for all ai.krill.* messages.
 * Uses MatrixClient.addPreprocessor() from @openclaw/matrix to intercept
 * messages BEFORE they reach the LLM pipeline.
 *
 * Architecture:
 *   1. registerService starts a background service
 *   2. Service finds the active MatrixClient from @openclaw/matrix
 *   3. Adds a preprocessor that detects ai.krill.* messages
 *   4. Preprocessor handles the message and blanks it so @openclaw/matrix ignores it
 */
interface OpenClawPluginApi {
    id: string;
    name: string;
    config: any;
    pluginConfig?: Record<string, unknown>;
    runtime: any;
    logger: {
        info: (...args: any[]) => void;
        warn: (...args: any[]) => void;
        error: (...args: any[]) => void;
        debug: (...args: any[]) => void;
    };
    registerTool: (tool: any, opts?: any) => void;
    registerHook: (events: string | string[], handler: any, opts?: any) => void;
    registerHttpHandler: (handler: any) => void;
    registerHttpRoute: (params: any) => void;
    registerChannel: (registration: any) => void;
    registerGatewayMethod: (method: string, handler: any) => void;
    registerCli: (registrar: any, opts?: any) => void;
    registerService: (service: {
        id: string;
        start: (ctx: any) => void | Promise<void>;
        stop?: (ctx: any) => void | Promise<void>;
    }) => void;
    registerProvider: (provider: any) => void;
    registerCommand: (command: any) => void;
    on: (hookName: string, handler: any, opts?: any) => void;
}
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
            config: {
                type: string;
                description: string;
                properties: {
                    allowedConfigSenders: {
                        type: string;
                        items: {
                            type: string;
                        };
                        description: string;
                    };
                    configPath: {
                        type: string;
                    };
                    restartCommand: {
                        type: string;
                    };
                    healthCheckTimeoutSeconds: {
                        type: string;
                    };
                };
            };
            access: {
                type: string;
                description: string;
                properties: {
                    enabled: {
                        type: string;
                        description: string;
                    };
                    krillApiUrl: {
                        type: string;
                        description: string;
                    };
                    maxPinAttempts: {
                        type: string;
                        description: string;
                    };
                    pinPromptMessage: {
                        type: string;
                    };
                    pinSuccessMessage: {
                        type: string;
                    };
                    pinFailureMessage: {
                        type: string;
                    };
                    pinBlockedMessage: {
                        type: string;
                    };
                };
            };
            allowlist: {
                type: string;
                description: string;
                properties: {
                    allowedSenders: {
                        type: string;
                        items: {
                            type: string;
                        };
                        description: string;
                    };
                    configPath: {
                        type: string;
                        description: string;
                    };
                };
            };
        };
        required: any[];
    };
    register(api: OpenClawPluginApi): void;
};
export default plugin;
