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

// Type declaration — OpenClaw plugin SDK types
// We declare inline to avoid dependency on the SDK package
interface OpenClawPluginApi {
  id: string;
  name: string;
  config: any;
  pluginConfig?: Record<string, unknown>;
  runtime: any;
  logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void; debug: (...args: any[]) => void };
  registerTool: (tool: any, opts?: any) => void;
  registerHook: (events: string | string[], handler: any, opts?: any) => void;
  registerHttpHandler: (handler: any) => void;
  registerHttpRoute: (params: any) => void;
  registerChannel: (registration: any) => void;
  registerGatewayMethod: (method: string, handler: any) => void;
  registerCli: (registrar: any, opts?: any) => void;
  registerService: (service: { id: string; start: (ctx: any) => void | Promise<void>; stop?: (ctx: any) => void | Promise<void> }) => void;
  registerProvider: (provider: any) => void;
  registerCommand: (command: any) => void;
  on: (hookName: string, handler: any, opts?: any) => void;
}
import crypto from "crypto";
import fs from "fs";
import path from "path";

// Import handlers
import { handlePairing, type PairingConfig } from "./handlers/pairing.js";
import { handleVerify } from "./handlers/verify.js";
import { handleHealth, markLlmActivity } from "./handlers/health.js";
import { handleConfig, initConfigHandler } from "./handlers/config.js";
import { handleAccess, initAccessHandler, isVerified, markVerified } from "./handlers/access.js";
import { handleAllowlist, initAllowlistHandler } from "./handlers/allowlist.js";
import { handleSense } from "./handlers/senses/index.js";
import type { SensesConfig } from "./handlers/senses/types.js";

// Plugin config schema
const configSchema = {
  type: "object",
  properties: {
    gatewayId: {
      type: "string",
      description: "Unique identifier for this gateway",
    },
    gatewaySecret: {
      type: "string",
      description: "Secret key for verification",
    },
    storagePath: {
      type: "string",
      description: "Path to store pairings and state",
    },
    agent: {
      type: "object",
      properties: {
        mxid: { type: "string" },
        displayName: { type: "string" },
        description: { type: "string" },
        capabilities: { type: "array", items: { type: "string" } },
      },
      required: ["mxid", "displayName"],
    },
    config: {
      type: "object",
      description: "Config update handler settings",
      properties: {
        allowedConfigSenders: { 
          type: "array", 
          items: { type: "string" },
          description: "MXIDs allowed to send config updates (e.g., Krill API bot)",
        },
        configPath: { type: "string" },
        restartCommand: { type: "string" },
        healthCheckTimeoutSeconds: { type: "number" },
      },
    },
    access: {
      type: "object",
      description: "PIN verification settings for new users",
      properties: {
        enabled: { type: "boolean", description: "Enable PIN verification for new users" },
        krillApiUrl: { type: "string", description: "Krill API URL for PIN verification" },
        maxPinAttempts: { type: "number", description: "Max failed attempts before blocking" },
        pinPromptMessage: { type: "string" },
        pinSuccessMessage: { type: "string" },
        pinFailureMessage: { type: "string" },
        pinBlockedMessage: { type: "string" },
      },
    },
    allowlist: {
      type: "object",
      description: "Allowlist management settings (for hire/unhire)",
      properties: {
        allowedSenders: {
          type: "array",
          items: { type: "string" },
          description: "MXIDs allowed to modify allowlist (e.g., Krill API bot)",
        },
        configPath: {
          type: "string",
          description: "Path to openclaw.json (default: ~/.openclaw/openclaw.json)",
        },
      },
    },
  },
  required: [],
};

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

// Shared state
let pluginConfig: KrillProtocolConfig | null = null;
let pluginApi: OpenClawPluginApi | null = null;

/**
 * Parse ai.krill message from text
 */
function parseKrillMessage(text: string): { type: string; content: any; auth?: any } | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed.type?.startsWith("ai.krill.")) {
      return {
        type: parsed.type,
        content: parsed.content,
        auth: parsed["ai.krill.auth"],
      };
    }
  } catch {
    // Not JSON or not a Krill message
  }
  return null;
}

/**
 * Validate Krill client authentication
 */
function isAuthenticatedKrillClient(auth: any, config: KrillProtocolConfig): boolean {
  if (!auth) return false;
  const token = auth.pairing_token;
  if (!token || typeof token !== "string") return false;
  if (!token.startsWith("krill_tk_v1_")) return false;
  return true;
}

/**
 * Check if message type requires authentication
 */
function requiresAuth(messageType: string): boolean {
  if (messageType === "ai.krill.pair.request") return false;
  if (messageType === "ai.krill.health.ping") return false;
  return true;
}

/**
 * Handle a Krill protocol message.
 * Returns true if handled (should be intercepted), false if it should pass through.
 */
async function handleKrillMessage(
  message: { type: string; content: any; auth?: any },
  senderId: string,
  roomId: string,
  sendResponse: (text: string) => Promise<void>
): Promise<boolean> {
  const { type, content, auth } = message;
  
  pluginApi?.logger.info(`[krill-protocol] Received: ${type} from ${senderId}`);
  
  if (requiresAuth(type)) {
    if (!isAuthenticatedKrillClient(auth, pluginConfig!)) {
      pluginApi?.logger.debug(`[krill-protocol] Ignoring unauthenticated: ${type}`);
      return true; // Intercept silently
    }
  }
  
  switch (type) {
    case "ai.krill.pair.request":
      await handlePairing.request(pluginConfig!, content, senderId, sendResponse);
      return true;
      
    case "ai.krill.verify.request":
      await handleVerify.request(pluginConfig!, content, sendResponse);
      return true;
      
    case "ai.krill.health.ping":
      await handleHealth.ping(pluginConfig!, content, sendResponse);
      return true;
      
    case "ai.krill.config.update":
      await handleConfig({
        sender: senderId,
        room_id: roomId,
        event_id: content.request_id || `ev_${Date.now()}`,
        content,
      });
      return true;
    
    case "ai.krill.allowlist":
      await handleAllowlist(content, senderId, sendResponse);
      return true;
    
    default:
      // Sense messages (ai.krill.sense.*)
      if (type.startsWith("ai.krill.sense.")) {
        const sensesConfig: SensesConfig = {
          storagePath: (pluginConfig as any)?.senses?.storagePath 
            || path.join(process.env.HOME || "", "jarvisx", "state", "location"),
          location: (pluginConfig as any)?.senses?.location,
        };
        return await handleSense({
          type,
          content,
          senderId,
          roomId,
          reply: sendResponse,
          logger: pluginApi!.logger,
          config: sensesConfig,
        });
      }
      
      // Senses control messages (ai.krill.senses.*)
      if (type.startsWith("ai.krill.senses.")) {
        pluginApi?.logger.info(`[krill-protocol] Senses control: ${type} (acknowledged)`);
        return true; // Intercept — don't send to LLM
      }

      // Pairing sub-messages (challenge, confirm, complete, reject, revoke, revoked)
      if (type.startsWith("ai.krill.pair.")) {
        pluginApi?.logger.info(`[krill-protocol] Pairing sub-message: ${type} (acknowledged)`);
        if (type === "ai.krill.pair.complete") {
          markVerified(senderId);
        }
        return true;
      }

      // Any other ai.krill.* message — intercept but log warning
      pluginApi?.logger.warn(`[krill-protocol] Unknown ai.krill type: ${type}`);
      return true; // Still intercept to prevent LLM seeing it
  }
}

/**
 * Try to find the active MatrixClient from @openclaw/matrix plugin.
 * Searches for the getAnyActiveMatrixClient function in the loaded modules.
 */
function findMatrixClient(): any | null {
  try {
    // The @openclaw/matrix plugin stores the client in a module-level Map.
    // Since both plugins run in the same Node.js process, we can require it.
    // Try multiple possible paths where @openclaw/matrix might be installed.
    const possiblePaths = [
      // System-wide OpenClaw (Linux packages, e.g., Kathy)
      "/usr/lib/node_modules/openclaw/extensions/matrix/src/matrix/active-client.js",
      // User-local OpenClaw (macOS, nvm, etc.)
      path.join(process.env.HOME || "", "node/lib/node_modules/openclaw/extensions/matrix/src/matrix/active-client.js"),
      // User extensions directory
      path.join(process.env.HOME || "", ".openclaw/extensions/matrix/src/matrix/active-client.js"),
      // npm global
      path.join(process.env.HOME || "", "node/lib/node_modules/@openclaw/matrix/src/matrix/active-client.js"),
    ];
    
    for (const modulePath of possiblePaths) {
      try {
        if (fs.existsSync(modulePath)) {
          // Dynamic require — works because we're in the same process
          const activeClientModule = require(modulePath);
          const client = activeClientModule.getAnyActiveMatrixClient?.() 
                      || activeClientModule.getActiveMatrixClient?.();
          if (client) {
            return client;
          }
        }
      } catch (e) {
        // Try next path
      }
    }

    // Fallback: search through require.cache for the active-client module
    for (const key of Object.keys(require.cache)) {
      if (key.includes("active-client") && key.includes("matrix")) {
        const mod = require.cache[key];
        const client = mod?.exports?.getAnyActiveMatrixClient?.()
                    || mod?.exports?.getActiveMatrixClient?.();
        if (client) {
          return client;
        }
      }
    }
  } catch (e) {
    pluginApi?.logger.debug(`[krill-protocol] Error finding MatrixClient: ${e}`);
  }
  return null;
}

/**
 * Install the Krill preprocessor on the MatrixClient.
 * The preprocessor intercepts ai.krill.* messages before they reach the LLM.
 */
function installPreprocessor(client: any): boolean {
  if (!client || typeof client.addPreprocessor !== "function") {
    return false;
  }

  const krillPreprocessor = {
    getSupportedEventTypes(): string[] {
      // We want to see all room messages
      return ["m.room.message"];
    },

    async processEvent(event: any, matrixClient: any): Promise<any> {
      try {
        const body = event?.content?.body;
        if (!body || typeof body !== "string") return;

        // Quick check before JSON parsing
        if (!body.startsWith('{"type":"ai.krill.')) return;

        const krillMsg = parseKrillMessage(body);
        if (!krillMsg) return;

        const senderId = event.sender || "";
        const roomId = event.room_id || "";

        pluginApi?.logger.info(`[krill-protocol] ⚡ Intercepted: ${krillMsg.type} in ${roomId}`);

        // Create a response function that sends via the MatrixClient
        const sendResponse = async (responseText: string) => {
          try {
            if (typeof matrixClient.sendText === "function") {
              await matrixClient.sendText(roomId, responseText);
            } else if (typeof matrixClient.sendMessage === "function") {
              await matrixClient.sendMessage(roomId, {
                msgtype: "m.text",
                body: responseText,
              });
            }
          } catch (err) {
            pluginApi?.logger.error(`[krill-protocol] Failed to send response: ${err}`);
          }
        };

        const handled = await handleKrillMessage(krillMsg, senderId, roomId, sendResponse);

        if (handled) {
          // Blank the event so @openclaw/matrix handler ignores it.
          // The handler checks: if (!rawBody && !mediaUrl) return;
          // So setting body to empty string will make it skip.
          event.content.body = "";
          // Also remove formatted_body if present
          if (event.content.formatted_body) {
            event.content.formatted_body = "";
          }
          pluginApi?.logger.info(`[krill-protocol] ✅ Handled & blanked: ${krillMsg.type}`);
        }
      } catch (err) {
        pluginApi?.logger.error(`[krill-protocol] Preprocessor error: ${err}`);
      }
      // processEvent returns void — the event is modified in-place
    },
  };

  client.addPreprocessor(krillPreprocessor);
  pluginApi?.logger.info("[krill-protocol] ✅ Preprocessor installed on MatrixClient");
  return true;
}

const plugin = {
  id: "krill-matrix-protocol",
  name: "Krill Matrix Protocol",
  description: "Handles all ai.krill.* protocol messages via MatrixClient preprocessor",
  configSchema,
  
  register(api: OpenClawPluginApi) {
    pluginApi = api;
    
    const config = api.config?.plugins?.entries?.["krill-matrix-protocol"]?.config as KrillProtocolConfig | undefined;
    
    if (!config) {
      api.logger.warn("[krill-protocol] No config found, plugin disabled");
      return;
    }
    
    pluginConfig = config;
    api.logger.info(`[krill-protocol] Loaded for gateway: ${config.gatewayId}`);
    
    // Initialize handlers
    const configSettings = (config as any).config || {};
    initConfigHandler({
      configPath: configSettings.configPath,
      allowedConfigSenders: configSettings.allowedConfigSenders || [],
      restartCommand: configSettings.restartCommand,
      healthCheckTimeoutSeconds: configSettings.healthCheckTimeoutSeconds,
      sendResponse: async (roomId: string, content: any) => {
        api.logger.info(`[config] Response: ${JSON.stringify(content)}`);
      },
      logger: api.logger,
    });
    
    const accessSettings = (config as any).access || {};
    if (accessSettings.enabled !== false) {
      initAccessHandler({
        storagePath: config.storagePath || path.join(process.env.HOME || "", ".openclaw", "krill"),
        krillApiUrl: accessSettings.krillApiUrl || "https://api.krillbot.network",
        maxPinAttempts: accessSettings.maxPinAttempts,
        pinPromptMessage: accessSettings.pinPromptMessage,
        pinSuccessMessage: accessSettings.pinSuccessMessage,
        pinFailureMessage: accessSettings.pinFailureMessage,
        pinBlockedMessage: accessSettings.pinBlockedMessage,
        logger: api.logger,
      });
    }
    
    const allowlistSettings = (config as any).allowlist || {};
    initAllowlistHandler({
      configPath: allowlistSettings.configPath,
      allowedSenders: allowlistSettings.allowedSenders || [],
      logger: api.logger,
    });
    
    if (config.storagePath) {
      const dir = path.dirname(config.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Register a background service that installs the preprocessor
    // once the MatrixClient is available
    api.registerService({
      id: "krill-protocol-interceptor",
      start: async (ctx) => {
        api.logger.info("[krill-protocol] 🔍 Starting interceptor service, looking for MatrixClient...");
        
        let installed = false;
        let attempts = 0;
        const maxAttempts = 30; // Try for 30 seconds
        
        const tryInstall = () => {
          attempts++;
          const client = findMatrixClient();
          if (client) {
            installed = installPreprocessor(client);
            if (installed) {
              api.logger.info(`[krill-protocol] 🎉 Interceptor active after ${attempts} attempt(s)`);
              return true;
            }
          }
          return false;
        };

        // Try immediately
        if (tryInstall()) return;

        // Retry with polling (MatrixClient may not be ready yet)
        await new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (tryInstall() || attempts >= maxAttempts) {
              clearInterval(interval);
              if (!installed) {
                api.logger.error("[krill-protocol] ❌ Could not find MatrixClient after 30 attempts. Interceptor NOT active.");
              }
              resolve();
            }
          }, 1000);
        });
      },
    });

    // Register HTTP handler (unchanged)
    api.registerHttpHandler(async (req: any, res: any) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!url.pathname.startsWith("/krill/")) return false;
      return false;
    });
    
    api.logger.info("[krill-protocol] ✅ Plugin registered (v1.2.0 — preprocessor mode)");
  },
};

export default plugin;
