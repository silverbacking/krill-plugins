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
  required: [],  // gatewayId/gatewaySecret are auto-provisioned by krill-agent-init
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
let pluginApi: ClawdbotPluginApi | null = null;

/**
 * Parse ai.krill message from text
 * Returns null if not a valid Krill message
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
 * Returns true if message comes from authenticated Krill App
 */
function isAuthenticatedKrillClient(auth: any, config: KrillProtocolConfig): boolean {
  if (!auth) return false;
  
  // Check for valid pairing token
  const token = auth.pairing_token;
  if (!token || typeof token !== "string") return false;
  
  // Token format: krill_tk_v1_<base64>
  if (!token.startsWith("krill_tk_v1_")) return false;
  
  // In production, validate token against stored pairings
  // For now, accept any well-formed token
  return true;
}

/**
 * Check if message type requires authentication
 * Some messages (like initial pairing) don't need auth
 */
function requiresAuth(messageType: string): boolean {
  // Pairing requests don't need auth (that's how you GET a token)
  if (messageType === "ai.krill.pair.request") return false;
  
  // Health pings from monitors may have special auth
  if (messageType === "ai.krill.health.ping") return false;
  
  // Everything else requires auth
  return true;
}

/**
 * Message interceptor - handles all ai.krill.* messages
 * Returns true if handled (intercept), false if message should pass to LLM
 * 
 * TRANSPARENCY: Only responds to authenticated Krill clients.
 * Messages from Element/other clients are silently ignored.
 */
async function handleKrillMessage(
  message: { type: string; content: any; auth?: any },
  senderId: string,
  roomId: string,
  sendResponse: (text: string) => Promise<void>
): Promise<boolean> {
  const { type, content, auth } = message;
  
  pluginApi?.logger.info(`[krill-protocol] Received: ${type}`);
  
  // Check if this message type requires authentication
  if (requiresAuth(type)) {
    if (!isAuthenticatedKrillClient(auth, pluginConfig!)) {
      // Not from Krill App - be transparent, don't respond
      pluginApi?.logger.debug(`[krill-protocol] Ignoring unauthenticated message: ${type}`);
      return true; // Intercept but don't respond (silent)
    }
  }
  
  switch (type) {
    // === PAIRING ===
    case "ai.krill.pair.request":
      await handlePairing.request(pluginConfig!, content, senderId, sendResponse);
      return true;
      
    // === VERIFICATION ===
    case "ai.krill.verify.request":
      await handleVerify.request(pluginConfig!, content, sendResponse);
      return true;
      
    // === HEALTH CHECK ===
    case "ai.krill.health.ping":
      await handleHealth.ping(pluginConfig!, content, sendResponse);
      return true;
      
    // === CONFIG UPDATE ===
    case "ai.krill.config.update":
      await handleConfig({
        sender: senderId,
        room_id: roomId,
        event_id: content.request_id || `ev_${Date.now()}`,
        content,
      });
      return true;
    
    // === ALLOWLIST MANAGEMENT ===
    case "ai.krill.allowlist":
      await handleAllowlist(content, senderId, sendResponse);
      return true;
    
    default:
      // Check if it's a sense message (ai.krill.sense.*)
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
      
      // Unknown ai.krill message - log but let it pass
      pluginApi?.logger.warn(`[krill-protocol] Unknown message type: ${type}`);
      return false;
  }
}

const plugin = {
  id: "krill-matrix-protocol",
  name: "Krill Matrix Protocol",
  description: "Handles all ai.krill.* protocol messages (pairing, verify, health)",
  configSchema,
  
  register(api: ClawdbotPluginApi) {
    pluginApi = api;
    
    // Get plugin config
    const config = api.config?.plugins?.entries?.["krill-matrix-protocol"]?.config as KrillProtocolConfig | undefined;
    
    if (!config) {
      api.logger.warn("[krill-protocol] No config found, plugin disabled");
      return;
    }
    
    pluginConfig = config;
    api.logger.info(`[krill-protocol] Loaded for gateway: ${config.gatewayId}`);
    
    // Initialize config handler
    const configSettings = (config as any).config || {};
    initConfigHandler({
      configPath: configSettings.configPath,
      allowedConfigSenders: configSettings.allowedConfigSenders || [],
      restartCommand: configSettings.restartCommand,
      healthCheckTimeoutSeconds: configSettings.healthCheckTimeoutSeconds,
      sendResponse: async (roomId, content) => {
        // Use Matrix client to send response
        api.logger.info(`[config] Response: ${JSON.stringify(content)}`);
      },
      logger: api.logger,
    });
    
    // Initialize access handler (PIN verification)
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
    
    // Initialize allowlist handler (for hire/unhire)
    const allowlistSettings = (config as any).allowlist || {};
    initAllowlistHandler({
      configPath: allowlistSettings.configPath,
      allowedSenders: allowlistSettings.allowedSenders || [],
      logger: api.logger,
    });
    
    // Initialize storage
    if (config.storagePath) {
      const dir = path.dirname(config.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    
    // Register message interceptor
    // This intercepts messages BEFORE they reach the LLM
    api.registerMessageInterceptor?.(async (ctx) => {
      const text = ctx.message?.text || ctx.message?.body || "";
      const senderId = ctx.senderId || "";
      const krillMsg = parseKrillMessage(text);
      
      // Handle Krill protocol messages (ai.krill.*)
      if (krillMsg) {
        const sendResponse = async (responseText: string) => {
          await ctx.reply?.(responseText);
        };
        
        const handled = await handleKrillMessage(
          krillMsg,
          senderId,
          ctx.roomId || "",
          sendResponse
        );
        
        // If pairing completed, mark user as verified
        if (krillMsg.type === "ai.krill.pair.complete") {
          markVerified(senderId);
        }
        
        return { handled };
      }
      
      // Not a Krill message - check if user needs PIN verification
      // (Only for users on allowlist but not yet verified)
      const accessSettings = (pluginConfig as any)?.access || {};
      if (accessSettings.enabled !== false) {
        const accessResult = await handleAccess(senderId, text);
        
        if (!accessResult.allowed) {
          // User needs to verify PIN
          if (accessResult.response) {
            await ctx.reply?.(accessResult.response);
          }
          return { handled: true }; // Don't pass to LLM
        }
      }
      
      // User is verified or access control disabled - pass to LLM
      markLlmActivity(); // Any non-protocol message = LLM is active
      return { handled: false };
    });
    
    // Register HTTP endpoints for backwards compatibility
    api.registerHttpHandler(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      
      if (!url.pathname.startsWith("/krill/")) {
        return false;
      }
      
      // Handle HTTP endpoints (for non-Matrix clients)
      // POST /krill/pair, /krill/verify, etc.
      
      return false; // Not handled via HTTP for now
    });
    
    api.logger.info("[krill-protocol] ✅ Protocol handler registered");
  },
};

export default plugin;
