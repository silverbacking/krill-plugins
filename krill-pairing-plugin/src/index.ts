import type { IncomingMessage, ServerResponse } from "node:http";
import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// Config schema
const configSchema = {
  type: "object",
  properties: {
    storagePath: {
      type: "string",
      description: "Path to store pairings data",
    },
    tokenExpiry: {
      type: "number",
      description: "Token expiry in seconds (0 = never)",
    },
  },
};

interface PairingConfig {
  storagePath?: string;
  tokenExpiry?: number;
}

interface Pairing {
  pairing_id: string;
  pairing_token_hash: string;
  agent_mxid: string;
  user_mxid: string;
  device_id: string;
  device_name: string;
  device_type?: string;
  created_at: number;
  last_seen_at: number;
  senses: Record<string, boolean>;
}

interface PairingsStore {
  pairings: Record<string, Pairing>;
}

let pluginConfig: PairingConfig | null = null;
let logger: { info: (msg: string) => void; warn: (msg: string) => void } | null = null;
let storagePath: string = "";
let pairingsStore: PairingsStore = { pairings: {} };

/**
 * Generate a secure pairing token
 */
function generatePairingToken(): string {
  const randomBytes = crypto.randomBytes(32).toString("base64url");
  return `krill_tk_v1_${randomBytes}`;
}

/**
 * Generate pairing ID
 */
function generatePairingId(): string {
  return `pair_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Hash a token for storage
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Load pairings from disk
 */
function loadPairings(): void {
  try {
    if (fs.existsSync(storagePath)) {
      const data = fs.readFileSync(storagePath, "utf-8");
      pairingsStore = JSON.parse(data);
      logger?.info(`Loaded ${Object.keys(pairingsStore.pairings).length} pairings`);
    }
  } catch (error) {
    logger?.warn(`Failed to load pairings: ${error}`);
    pairingsStore = { pairings: {} };
  }
}

/**
 * Save pairings to disk
 */
function savePairings(): void {
  try {
    const dir = path.dirname(storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(storagePath, JSON.stringify(pairingsStore, null, 2));
  } catch (error) {
    logger?.warn(`Failed to save pairings: ${error}`);
  }
}

/**
 * Read JSON body from request
 */
async function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res: ServerResponse, status: number, data: any): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

/**
 * Handle POST /krill/pair - Create new pairing
 */
async function handlePair(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const { agent_mxid, user_mxid, device_id, device_name, device_type } = body;

    if (!agent_mxid || !user_mxid || !device_id) {
      sendJson(res, 400, { success: false, error: "Missing required fields" });
      return;
    }

    // Check if pairing already exists for this user+device
    const existingPairing = Object.values(pairingsStore.pairings).find(
      (p) => p.user_mxid === user_mxid && p.device_id === device_id && p.agent_mxid === agent_mxid
    );

    if (existingPairing) {
      // Revoke old pairing
      delete pairingsStore.pairings[existingPairing.pairing_id];
      logger?.info(`Revoked existing pairing ${existingPairing.pairing_id} for re-pairing`);
    }

    // Generate new pairing
    const pairing_id = generatePairingId();
    const pairing_token = generatePairingToken();
    const now = Math.floor(Date.now() / 1000);

    const pairing: Pairing = {
      pairing_id,
      pairing_token_hash: hashToken(pairing_token),
      agent_mxid,
      user_mxid,
      device_id,
      device_name: device_name || device_id,
      device_type,
      created_at: now,
      last_seen_at: now,
      senses: {},
    };

    pairingsStore.pairings[pairing_id] = pairing;
    savePairings();

    logger?.info(`New pairing created: ${pairing_id} (${user_mxid} → ${agent_mxid})`);

    sendJson(res, 200, {
      success: true,
      pairing: {
        pairing_id,
        pairing_token, // Only returned once!
        agent_mxid,
        created_at: now,
      },
    });
  } catch (error) {
    sendJson(res, 400, { success: false, error: "Invalid request" });
  }
}

/**
 * Handle GET /krill/pairings - List pairings for an agent
 */
async function handleListPairings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const agent_mxid = url.searchParams.get("agent");

  const pairings = Object.values(pairingsStore.pairings)
    .filter((p) => !agent_mxid || p.agent_mxid === agent_mxid)
    .map((p) => ({
      pairing_id: p.pairing_id,
      agent_mxid: p.agent_mxid,
      user_mxid: p.user_mxid,
      device_id: p.device_id,
      device_name: p.device_name,
      device_type: p.device_type,
      created_at: p.created_at,
      last_seen_at: p.last_seen_at,
      senses: p.senses,
    }));

  sendJson(res, 200, { pairings });
}

/**
 * Handle DELETE /krill/pair/{pairing_id} - Revoke pairing
 */
async function handleRevokePairing(pairingId: string, res: ServerResponse): Promise<void> {
  if (pairingsStore.pairings[pairingId]) {
    delete pairingsStore.pairings[pairingId];
    savePairings();
    logger?.info(`Pairing revoked: ${pairingId}`);
    sendJson(res, 200, { success: true, revoked: pairingId });
  } else {
    sendJson(res, 404, { success: false, error: "Pairing not found" });
  }
}

/**
 * Handle POST /krill/pair/{pairing_id}/senses - Update senses
 */
async function handleUpdateSenses(
  pairingId: string,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const pairing = pairingsStore.pairings[pairingId];
  if (!pairing) {
    sendJson(res, 404, { success: false, error: "Pairing not found" });
    return;
  }

  try {
    const senses = await readJsonBody(req);
    pairing.senses = { ...pairing.senses, ...senses };
    savePairings();
    logger?.info(`Senses updated for ${pairingId}: ${JSON.stringify(senses)}`);
    sendJson(res, 200, { success: true, senses: pairing.senses });
  } catch {
    sendJson(res, 400, { success: false, error: "Invalid request" });
  }
}

/**
 * Handle POST /krill/validate - Validate a pairing token
 */
async function handleValidate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const { pairing_token } = body;

    if (!pairing_token) {
      sendJson(res, 400, { valid: false, error: "Missing pairing_token" });
      return;
    }

    const tokenHash = hashToken(pairing_token);
    const pairing = Object.values(pairingsStore.pairings).find(
      (p) => p.pairing_token_hash === tokenHash
    );

    if (pairing) {
      // Update last_seen
      pairing.last_seen_at = Math.floor(Date.now() / 1000);
      savePairings();

      sendJson(res, 200, {
        valid: true,
        pairing: {
          pairing_id: pairing.pairing_id,
          agent_mxid: pairing.agent_mxid,
          user_mxid: pairing.user_mxid,
          device_id: pairing.device_id,
          senses: pairing.senses,
        },
      });
    } else {
      sendJson(res, 200, { valid: false, error: "Invalid or expired token" });
    }
  } catch {
    sendJson(res, 400, { valid: false, error: "Invalid request" });
  }
}

/**
 * Handle Matrix ai.krill.pair.complete events
 * When a user pairs with an agent via the Krill app, send a welcome notification
 */
async function handleMatrixPairingEvent(event: any): Promise<boolean> {
  // Only handle ai.krill.pair.complete events
  if (event.type !== "ai.krill.pair.complete") {
    return false;
  }
  
  try {
    const content = event.content || {};
    const userId = content.user_id || event.sender;
    const roomId = event.room_id;
    
    logger?.info(`Received pairing event from ${userId} in room ${roomId}`);
    
    // Fetch user profile from Matrix
    let displayName = userId.split(":")[0].replace("@", "");
    let avatarUrl: string | null = null;
    
    if (matrixApi?.getMatrixClient) {
      try {
        const client = matrixApi.getMatrixClient();
        if (client) {
          const profile = await client.getProfileInfo(userId);
          displayName = profile?.displayname || displayName;
          avatarUrl = profile?.avatar_url || null;
        }
      } catch (e) {
        logger?.warn(`Failed to fetch profile for ${userId}: ${e}`);
      }
    }
    
    // Format welcome message for the agent
    const welcomeMessage = `🦐 **New Krill Connection!**

**${displayName}** just paired with you via Krill App.

• **User ID:** ${userId}
• **Platform:** ${content.platform || "unknown"}
• **Time:** ${new Date().toLocaleString()}

Say hello and introduce yourself! 👋`;

    // Send message to the room (this will be seen by the agent)
    if (matrixApi?.sendMatrixMessage) {
      await matrixApi.sendMatrixMessage(roomId, welcomeMessage);
      logger?.info(`Sent welcome notification to room ${roomId}`);
    } else if (matrixApi?.getMatrixClient) {
      const client = matrixApi.getMatrixClient();
      if (client) {
        await client.sendMessage(roomId, {
          msgtype: "m.text",
          body: welcomeMessage,
          format: "org.matrix.custom.html",
          formatted_body: welcomeMessage.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>"),
        });
        logger?.info(`Sent welcome notification to room ${roomId} via client`);
      }
    }
    
    return true; // Event handled
  } catch (error) {
    logger?.warn(`Error handling pairing event: ${error}`);
    return false;
  }
}

/**
 * HTTP request handler
 */
async function handleKrillPairingRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathParts = url.pathname.split("/").filter(Boolean);

  // Only handle /krill/pair* paths
  if (pathParts[0] !== "krill") return false;

  // POST /krill/pair
  if (pathParts[1] === "pair" && !pathParts[2] && req.method === "POST") {
    await handlePair(req, res);
    return true;
  }

  // GET /krill/pairings
  if (pathParts[1] === "pairings" && req.method === "GET") {
    await handleListPairings(req, res);
    return true;
  }

  // POST /krill/validate
  if (pathParts[1] === "validate" && req.method === "POST") {
    await handleValidate(req, res);
    return true;
  }

  // DELETE /krill/pair/{id}
  if (pathParts[1] === "pair" && pathParts[2] && req.method === "DELETE") {
    await handleRevokePairing(pathParts[2], res);
    return true;
  }

  // POST /krill/pair/{id}/senses
  if (pathParts[1] === "pair" && pathParts[2] && pathParts[3] === "senses" && req.method === "POST") {
    await handleUpdateSenses(pathParts[2], req, res);
    return true;
  }

  return false;
}

let matrixApi: any = null;

const plugin = {
  id: "krill-pairing",
  name: "Krill Pairing",
  description: "Krill user-agent pairing and token management",
  configSchema,
  uiHints: {
    storagePath: { label: "Storage Path", placeholder: "~/.clawdbot/krill/pairings.json" },
  },

  register(api: ClawdbotPluginApi) {
    logger = api.logger;
    matrixApi = api;

    // Get config
    const config = api.config?.plugins?.entries?.["krill-pairing"]?.config as PairingConfig | undefined;
    pluginConfig = config || {};

    // Setup storage path
    storagePath = pluginConfig.storagePath || 
      path.join(process.env.HOME || "", ".clawdbot", "krill", "pairings.json");

    // Load existing pairings
    loadPairings();

    api.logger.info(`Krill pairing plugin loaded. Storage: ${storagePath}`);
    api.logger.info(`Active pairings: ${Object.keys(pairingsStore.pairings).length}`);

    // Register HTTP handler
    api.registerHttpHandler(handleKrillPairingRequest);
    
    // Register Matrix event handler for pairing events
    if (api.registerMatrixEventHandler) {
      api.registerMatrixEventHandler(handleMatrixPairingEvent);
      api.logger.info("Registered Matrix event handler for ai.krill.pair.complete");
    } else {
      api.logger.warn("registerMatrixEventHandler not available - pairing notifications won't work");
    }

    // Register CLI commands
    api.registerCli?.(({ program }) => {
      const krill = program.command("krill-pair").description("Krill pairing commands");

      krill.command("list").description("List active pairings").action(() => {
        const pairings = Object.values(pairingsStore.pairings);
        if (pairings.length === 0) {
          console.log("No active pairings");
          return;
        }
        console.log(`\n🔗 Active pairings (${pairings.length}):\n`);
        pairings.forEach((p, i) => {
          console.log(`${i + 1}. ${p.pairing_id}`);
          console.log(`   User: ${p.user_mxid}`);
          console.log(`   Agent: ${p.agent_mxid}`);
          console.log(`   Device: ${p.device_name} (${p.device_id})`);
          console.log(`   Created: ${new Date(p.created_at * 1000).toISOString()}`);
          console.log(`   Last seen: ${new Date(p.last_seen_at * 1000).toISOString()}`);
          console.log("");
        });
      });

      krill.command("revoke <pairingId>").description("Revoke a pairing").action((pairingId: string) => {
        if (pairingsStore.pairings[pairingId]) {
          delete pairingsStore.pairings[pairingId];
          savePairings();
          console.log(`✅ Pairing ${pairingId} revoked`);
        } else {
          console.log(`❌ Pairing ${pairingId} not found`);
        }
      });
    }, { commands: ["krill-pair"] });
  },
};

export default plugin;
