/**
 * Krill Protocol Interceptor
 * 
 * Intercepts Krill protocol messages before they reach the agent.
 * Returns true if the message was handled, false otherwise.
 */

import type { MatrixClient } from "matrix-bot-sdk";
import crypto from "crypto";
import fs from "fs";
import path from "path";

export interface KrillConfig {
  gatewayId: string;
  gatewaySecret: string;
  agents: Array<{
    mxid: string;
    displayName: string;
    description?: string;
    capabilities?: string[];
  }>;
  pairingsPath?: string;
}

export interface KrillPairing {
  pairing_id: string;
  pairing_token_hash: string;
  agent_mxid: string;
  user_mxid: string;
  device_id: string;
  device_name: string;
  created_at: number;
  last_seen_at: number;
  senses: Record<string, boolean>;
}

interface PairingsStore {
  pairings: Record<string, KrillPairing>;
}

let config: KrillConfig | null = null;
let pairingsStore: PairingsStore = { pairings: {} };
let pairingsPath = "";
let startTime = Date.now(); // Track uptime

/**
 * Initialize the Krill interceptor
 */
export function initKrillInterceptor(cfg: KrillConfig): void {
  config = cfg;
  pairingsPath = cfg.pairingsPath || 
    path.join(process.env.HOME || "", ".clawdbot", "krill", "pairings.json");
  loadPairings();
}

/**
 * Load pairings from disk
 */
function loadPairings(): void {
  try {
    if (fs.existsSync(pairingsPath)) {
      pairingsStore = JSON.parse(fs.readFileSync(pairingsPath, "utf-8"));
    }
  } catch {
    pairingsStore = { pairings: {} };
  }
}

/**
 * Save pairings to disk
 */
function savePairings(): void {
  try {
    const dir = path.dirname(pairingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(pairingsPath, JSON.stringify(pairingsStore, null, 2));
  } catch {}
}

/**
 * Generate a secure token
 */
function generateToken(): string {
  return `krill_tk_v1_${crypto.randomBytes(32).toString("base64url")}`;
}

/**
 * Hash a token
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Try to parse a Krill message from text
 */
function parseKrillMessage(text: string): { type: string; content: any } | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed.type && parsed.type.startsWith("ai.krill.")) {
      return parsed;
    }
  } catch {}
  return null;
}

/**
 * Format a friendly message for display alongside the protocol response
 */
function formatFriendlyMessage(type: string, data: any): string {
  switch (type) {
    case "ai.krill.verify.response":
      if (data.verified && data.agent) {
        return `✅ **${data.agent.display_name}** verificat i online!\n` +
               `🔧 Capacitats: ${(data.agent.capabilities || []).join(", ")}`;
      }
      return "❌ No s'ha pogut verificar l'agent.";
      
    case "ai.krill.pair.response":
      if (data.success && data.agent) {
        return `🔗 **Connectat amb ${data.agent.display_name}!**\n` +
               `${data.message || "Ara podem parlar!"}`;
      }
      return "❌ No s'ha pogut completar el pairing.";
      
    case "ai.krill.pair.revoked":
      return data.success 
        ? "👋 Pairing revocat. Fins aviat!" 
        : "❌ No s'ha trobat el pairing.";
        
    case "ai.krill.senses.updated":
      if (data.success) {
        const enabled = Object.entries(data.senses || {})
          .filter(([_, v]) => v)
          .map(([k]) => k);
        return `📡 Senses actualitzats: ${enabled.join(", ") || "cap"}`;
      }
      return "❌ No s'han pogut actualitzar els senses.";
      
    default:
      return "";
  }
}

/**
 * Handle verify request
 */
function handleVerifyRequest(content: any, agentMxid: string): { json: string; friendly: string } {
  if (!config) {
    const resp = { type: "ai.krill.verify.response", content: { verified: false, error: "NOT_CONFIGURED" } };
    return { json: JSON.stringify(resp), friendly: "❌ Agent no configurat." };
  }
  
  const agent = config.agents.find(a => a.mxid === agentMxid);
  const responseContent = {
    challenge: content.challenge,
    verified: true,
    agent: agent ? {
      mxid: agent.mxid,
      display_name: agent.displayName,
      gateway_id: config.gatewayId,
      capabilities: agent.capabilities || ["chat"],
      status: "online",
    } : null,
    responded_at: Math.floor(Date.now() / 1000),
  };
  const response = { type: "ai.krill.verify.response", content: responseContent };
  return { 
    json: JSON.stringify(response), 
    friendly: formatFriendlyMessage("ai.krill.verify.response", responseContent) 
  };
}

/**
 * Handle pair request
 */
function handlePairRequest(content: any, agentMxid: string, userMxid: string): { json: string; friendly: string } {
  if (!config) {
    const resp = { type: "ai.krill.pair.response", content: { success: false, error: "NOT_CONFIGURED" } };
    return { json: JSON.stringify(resp), friendly: "❌ Agent no configurat." };
  }
  
  const { device_id, device_name, device_type } = content;
  
  // Check for existing pairing for this user+device
  const existingKey = Object.keys(pairingsStore.pairings).find(k => {
    const p = pairingsStore.pairings[k];
    return p.user_mxid === userMxid && p.device_id === device_id && p.agent_mxid === agentMxid;
  });
  if (existingKey) {
    delete pairingsStore.pairings[existingKey];
  }
  
  // Create new pairing
  const pairing_id = `pair_${crypto.randomBytes(8).toString("hex")}`;
  const pairing_token = generateToken();
  const now = Math.floor(Date.now() / 1000);
  
  pairingsStore.pairings[pairing_id] = {
    pairing_id,
    pairing_token_hash: hashToken(pairing_token),
    agent_mxid: agentMxid,
    user_mxid: userMxid,
    device_id,
    device_name: device_name || device_id,
    created_at: now,
    last_seen_at: now,
    senses: {},
  };
  savePairings();
  
  const agent = config.agents.find(a => a.mxid === agentMxid);
  const responseContent = {
    success: true,
    pairing_id,
    pairing_token,
    agent: agent ? {
      mxid: agent.mxid,
      display_name: agent.displayName,
      capabilities: agent.capabilities || ["chat"],
    } : null,
    created_at: now,
    message: "Hola! Ara estem connectats. Què puc fer per tu?",
  };
  const response = { type: "ai.krill.pair.response", content: responseContent };
  return { 
    json: JSON.stringify(response), 
    friendly: formatFriendlyMessage("ai.krill.pair.response", responseContent) 
  };
}

/**
 * Handle pair revoke
 */
function handlePairRevoke(content: any): { json: string; friendly: string } {
  const { pairing_token } = content;
  const tokenHash = hashToken(pairing_token);
  
  const pairingKey = Object.keys(pairingsStore.pairings).find(k => 
    pairingsStore.pairings[k].pairing_token_hash === tokenHash
  );
  
  if (pairingKey) {
    delete pairingsStore.pairings[pairingKey];
    savePairings();
    const responseContent = { success: true, message: "Pairing revocat. Fins aviat!" };
    const response = { type: "ai.krill.pair.revoked", content: responseContent };
    return { 
      json: JSON.stringify(response), 
      friendly: formatFriendlyMessage("ai.krill.pair.revoked", responseContent) 
    };
  }
  
  const responseContent = { success: false, error: "PAIRING_NOT_FOUND" };
  const response = { type: "ai.krill.pair.revoked", content: responseContent };
  return { 
    json: JSON.stringify(response), 
    friendly: formatFriendlyMessage("ai.krill.pair.revoked", responseContent) 
  };
}

/**
 * Handle health ping - responds with agent status (no LLM involved)
 */
function handleHealthPing(content: any, agentMxid: string): { json: string; friendly: string } {
  if (!config) {
    const resp = { 
      type: "ai.krill.health.pong", 
      content: { 
        timestamp: content.timestamp,
        request_id: content.request_id,
        status: "offline",
        error: "NOT_CONFIGURED" 
      } 
    };
    return { json: JSON.stringify(resp), friendly: "" };
  }
  
  const agent = config.agents.find(a => a.mxid === agentMxid);
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  
  const responseContent = {
    timestamp: content.timestamp,
    request_id: content.request_id,
    agent_id: agentMxid,
    gateway_id: config.gatewayId,
    status: "online",
    load: "low", // TODO: Could be dynamic based on actual load
    uptime_seconds: uptimeSeconds,
    version: "0.2.0",
    capabilities: agent?.capabilities || ["chat"],
    responded_at: Date.now(),
  };
  
  const response = { type: "ai.krill.health.pong", content: responseContent };
  
  // No friendly message for healthchecks - they're automated
  return { json: JSON.stringify(response), friendly: "" };
}

/**
 * Handle senses update
 */
function handleSensesUpdate(content: any): { json: string; friendly: string } {
  const { pairing_token, senses } = content;
  const tokenHash = hashToken(pairing_token);
  
  const pairing = Object.values(pairingsStore.pairings).find(p => 
    p.pairing_token_hash === tokenHash
  );
  
  if (pairing) {
    pairing.senses = { ...pairing.senses, ...senses };
    pairing.last_seen_at = Math.floor(Date.now() / 1000);
    savePairings();
    const responseContent = { success: true, senses: pairing.senses };
    const response = { type: "ai.krill.senses.updated", content: responseContent };
    return { 
      json: JSON.stringify(response), 
      friendly: formatFriendlyMessage("ai.krill.senses.updated", responseContent) 
    };
  }
  
  const responseContent = { success: false, error: "INVALID_TOKEN" };
  const response = { type: "ai.krill.senses.updated", content: responseContent };
  return { 
    json: JSON.stringify(response), 
    friendly: formatFriendlyMessage("ai.krill.senses.updated", responseContent) 
  };
}

/**
 * Validate a pairing token
 * Returns the pairing if valid, null otherwise
 */
export function validatePairingToken(token: string): KrillPairing | null {
  const tokenHash = hashToken(token);
  const pairing = Object.values(pairingsStore.pairings).find(p => 
    p.pairing_token_hash === tokenHash
  );
  if (pairing) {
    pairing.last_seen_at = Math.floor(Date.now() / 1000);
    savePairings();
  }
  return pairing || null;
}

/**
 * Authentication context extracted from a message
 */
export interface KrillAuthContext {
  authenticated: boolean;
  pairing?: KrillPairing;
  deviceName?: string;
  senses?: Record<string, boolean>;
}

/**
 * Extract and validate authentication from a Matrix event content
 * Supports Option B: ai.krill.auth field in event content
 * 
 * @param eventContent - The full Matrix event content object
 * @param senderId - The Matrix user ID of the sender
 * @returns Authentication context with pairing info if valid
 */
export function extractAuthFromEvent(
  eventContent: Record<string, unknown>,
  senderId: string,
): KrillAuthContext {
  // Check for ai.krill.auth field
  const auth = eventContent["ai.krill.auth"] as { pairing_token?: string } | undefined;
  
  if (!auth?.pairing_token) {
    // No authentication provided - check if sender has any pairing
    const existingPairing = Object.values(pairingsStore.pairings).find(
      p => p.user_mxid === senderId
    );
    
    if (existingPairing) {
      // User has pairing but didn't authenticate this message
      // We can still identify them but mark as not explicitly authenticated
      return {
        authenticated: false,
        pairing: existingPairing,
        deviceName: existingPairing.device_name,
        senses: existingPairing.senses,
      };
    }
    
    return { authenticated: false };
  }
  
  // Validate the token
  const pairing = validatePairingToken(auth.pairing_token);
  
  if (!pairing) {
    console.log(`[krill] Invalid pairing token from ${senderId}`);
    return { authenticated: false };
  }
  
  // Verify sender matches pairing
  if (pairing.user_mxid !== senderId) {
    console.log(`[krill] Token/sender mismatch: expected ${pairing.user_mxid}, got ${senderId}`);
    return { authenticated: false };
  }
  
  console.log(`[krill] Authenticated message from ${pairing.device_name} (${senderId})`);
  
  return {
    authenticated: true,
    pairing,
    deviceName: pairing.device_name,
    senses: pairing.senses,
  };
}

/**
 * Build context string to prepend to agent messages
 * This adds Krill context without the agent needing to understand the protocol
 */
export function buildAgentContext(authContext: KrillAuthContext): string | null {
  if (!authContext.pairing) {
    return null;
  }
  
  const lines: string[] = [];
  lines.push(`[Krill Context]`);
  lines.push(`• Device: ${authContext.deviceName}`);
  lines.push(`• Authenticated: ${authContext.authenticated ? "✓" : "✗"}`);
  
  // Add enabled senses
  if (authContext.senses) {
    const enabledSenses = Object.entries(authContext.senses)
      .filter(([_, enabled]) => enabled)
      .map(([sense]) => sense);
    
    if (enabledSenses.length > 0) {
      lines.push(`• Senses enabled: ${enabledSenses.join(", ")}`);
    }
  }
  
  return lines.join("\n");
}

/**
 * Main interceptor function
 * Returns: { handled: true, response: string } if handled, { handled: false } otherwise
 * 
 * Sends two messages:
 * 1. Protocol JSON (for the Krill app to parse)
 * 2. Friendly message (for human-readable display)
 */
export async function interceptKrillMessage(
  client: MatrixClient,
  roomId: string,
  senderId: string,
  messageBody: string,
  selfUserId: string,
): Promise<{ handled: boolean; response?: string }> {
  // Try to parse as Krill message
  const krillMsg = parseKrillMessage(messageBody);
  if (!krillMsg) {
    return { handled: false };
  }
  
  console.log(`[krill] Intercepted ${krillMsg.type} from ${senderId}`);
  
  let result: { json: string; friendly: string };
  
  switch (krillMsg.type) {
    case "ai.krill.verify.request":
      result = handleVerifyRequest(krillMsg.content, selfUserId);
      break;
      
    case "ai.krill.pair.request":
      result = handlePairRequest(krillMsg.content, selfUserId, senderId);
      break;
      
    case "ai.krill.pair.revoke":
      result = handlePairRevoke(krillMsg.content);
      break;
      
    case "ai.krill.senses.update":
      result = handleSensesUpdate(krillMsg.content);
      break;
    
    case "ai.krill.health.ping":
      result = handleHealthPing(krillMsg.content, selfUserId);
      break;
      
    default:
      // Unknown Krill message type, don't intercept
      return { handled: false };
  }
  
  // Send protocol response (JSON) - for the Krill app
  await client.sendMessage(roomId, {
    msgtype: "m.text",
    body: result.json,
  });
  
  // Send friendly response - for human-readable display
  if (result.friendly) {
    await client.sendMessage(roomId, {
      msgtype: "m.text",
      body: result.friendly,
      format: "org.matrix.custom.html",
      formatted_body: result.friendly.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>"),
    });
  }
  
  return { handled: true, response: result.json };
}
