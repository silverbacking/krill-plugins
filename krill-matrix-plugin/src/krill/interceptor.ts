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
 * Handle verify request
 */
function handleVerifyRequest(content: any, agentMxid: string): string {
  if (!config) return JSON.stringify({ type: "ai.krill.verify.response", content: { verified: false, error: "NOT_CONFIGURED" } });
  
  const agent = config.agents.find(a => a.mxid === agentMxid);
  const response = {
    type: "ai.krill.verify.response",
    content: {
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
    },
  };
  return JSON.stringify(response);
}

/**
 * Handle pair request
 */
function handlePairRequest(content: any, agentMxid: string, userMxid: string): string {
  if (!config) return JSON.stringify({ type: "ai.krill.pair.response", content: { success: false, error: "NOT_CONFIGURED" } });
  
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
  const response = {
    type: "ai.krill.pair.response",
    content: {
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
    },
  };
  return JSON.stringify(response);
}

/**
 * Handle pair revoke
 */
function handlePairRevoke(content: any): string {
  const { pairing_token } = content;
  const tokenHash = hashToken(pairing_token);
  
  const pairingKey = Object.keys(pairingsStore.pairings).find(k => 
    pairingsStore.pairings[k].pairing_token_hash === tokenHash
  );
  
  if (pairingKey) {
    delete pairingsStore.pairings[pairingKey];
    savePairings();
    return JSON.stringify({
      type: "ai.krill.pair.revoked",
      content: { success: true, message: "Pairing revocat. Fins aviat!" },
    });
  }
  
  return JSON.stringify({
    type: "ai.krill.pair.revoked",
    content: { success: false, error: "PAIRING_NOT_FOUND" },
  });
}

/**
 * Handle senses update
 */
function handleSensesUpdate(content: any): string {
  const { pairing_token, senses } = content;
  const tokenHash = hashToken(pairing_token);
  
  const pairing = Object.values(pairingsStore.pairings).find(p => 
    p.pairing_token_hash === tokenHash
  );
  
  if (pairing) {
    pairing.senses = { ...pairing.senses, ...senses };
    pairing.last_seen_at = Math.floor(Date.now() / 1000);
    savePairings();
    return JSON.stringify({
      type: "ai.krill.senses.updated",
      content: { success: true, senses: pairing.senses },
    });
  }
  
  return JSON.stringify({
    type: "ai.krill.senses.updated",
    content: { success: false, error: "INVALID_TOKEN" },
  });
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
 * Main interceptor function
 * Returns: { handled: true, response: string } if handled, { handled: false } otherwise
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
  
  let response: string;
  
  switch (krillMsg.type) {
    case "ai.krill.verify.request":
      response = handleVerifyRequest(krillMsg.content, selfUserId);
      break;
      
    case "ai.krill.pair.request":
      response = handlePairRequest(krillMsg.content, selfUserId, senderId);
      break;
      
    case "ai.krill.pair.revoke":
      response = handlePairRevoke(krillMsg.content);
      break;
      
    case "ai.krill.senses.update":
      response = handleSensesUpdate(krillMsg.content);
      break;
      
    default:
      // Unknown Krill message type, don't intercept
      return { handled: false };
  }
  
  // Send response
  await client.sendMessage(roomId, {
    msgtype: "m.text",
    body: response,
  });
  
  return { handled: true, response };
}
