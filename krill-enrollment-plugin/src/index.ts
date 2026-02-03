import type { IncomingMessage, ServerResponse } from "node:http";
import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import crypto from "crypto";

// Import verify handler
import { processVerifyRequest, isVerifyRequest, createVerifyResponseEvent } from "./verify-handler.js";

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
      description: "Secret key for generating verification hashes",
    },
    gatewayUrl: {
      type: "string",
      description: "Public URL of this gateway (for Krill App callbacks)",
    },
    agentsRoomId: {
      type: "string",
      description: "Matrix room ID for publishing enrolled agents",
    },
    agents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          mxid: { type: "string" },
          displayName: { type: "string" },
          description: { type: "string" },
          capabilities: { type: "array", items: { type: "string" } },
        },
        required: ["mxid", "displayName"],
      },
      description: "List of agents to enroll",
    },
  },
  required: ["gatewayId", "gatewaySecret"],
};

interface KrillConfig {
  gatewayId: string;
  gatewaySecret: string;
  gatewayUrl?: string;
  agentsRoomId?: string;
  agents?: Array<{
    mxid: string;
    displayName: string;
    description?: string;
    capabilities?: string[];
  }>;
}

interface VerifyRequest {
  agent_mxid: string;
  gateway_id: string;
  verification_hash: string;
  enrolled_at: number;
}

let pluginConfig: KrillConfig | null = null;
let pluginApi: ClawdbotPluginApi | null = null;
let logger: { info: (msg: string) => void; warn: (msg: string) => void } | null = null;

/**
 * Generate verification hash for an agent
 */
function generateHash(
  secret: string,
  agentMxid: string,
  gatewayId: string,
  enrolledAt: number
): string {
  const message = `${agentMxid}|${gatewayId}|${enrolledAt}`;
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
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
 * HTTP request handler for Krill endpoints
 */
async function handleKrillRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;

  // Only handle /krill/* paths
  if (!path.startsWith("/krill/")) {
    return false;
  }

  logger?.info(`[krill] ${req.method} ${path}`);

  if (!pluginConfig) {
    sendJson(res, 500, { error: "Plugin not configured" });
    return true;
  }

  // POST /krill/verify
  if (path === "/krill/verify" && req.method === "POST") {
    try {
      const body: VerifyRequest = await readJsonBody(req);
      const { agent_mxid, gateway_id, verification_hash, enrolled_at } = body;

      // Check gateway_id matches
      if (gateway_id !== pluginConfig.gatewayId) {
        sendJson(res, 200, { valid: false, error: "Gateway ID mismatch" });
        return true;
      }

      // Recalculate hash
      const expectedHash = generateHash(
        pluginConfig.gatewaySecret,
        agent_mxid,
        gateway_id,
        enrolled_at
      );

      if (verification_hash === expectedHash) {
        const agent = pluginConfig.agents?.find((a) => a.mxid === agent_mxid);
        sendJson(res, 200, {
          valid: true,
          agent: agent
            ? {
                mxid: agent.mxid,
                display_name: agent.displayName,
                description: agent.description,
                capabilities: agent.capabilities,
                status: "online",
              }
            : null,
        });
      } else {
        sendJson(res, 200, { valid: false, error: "Hash mismatch" });
      }
    } catch (error) {
      sendJson(res, 400, { valid: false, error: "Invalid request" });
    }
    return true;
  }

  // POST /krill/enroll
  if (path === "/krill/enroll" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const { agent_mxid, display_name, description, capabilities } = body;

      const enrolled_at = Math.floor(Date.now() / 1000);
      const verification_hash = generateHash(
        pluginConfig.gatewaySecret,
        agent_mxid,
        pluginConfig.gatewayId,
        enrolled_at
      );

      sendJson(res, 200, {
        success: true,
        enrollment: {
          type: "ai.krill.agent",
          state_key: agent_mxid,
          content: {
            gateway_id: pluginConfig.gatewayId,
            gateway_url: pluginConfig.gatewayUrl,
            display_name,
            description,
            capabilities: capabilities || ["chat"],
            enrolled_at,
            verification_hash,
          },
        },
      });
    } catch (error) {
      sendJson(res, 400, { success: false, error: "Invalid request" });
    }
    return true;
  }

  // GET /krill/agents
  if (path === "/krill/agents" && req.method === "GET") {
    const agents = (pluginConfig.agents || []).map((agent) => {
      const enrolled_at = Math.floor(Date.now() / 1000);
      const verification_hash = generateHash(
        pluginConfig!.gatewaySecret,
        agent.mxid,
        pluginConfig!.gatewayId,
        enrolled_at
      );

      return {
        mxid: agent.mxid,
        display_name: agent.displayName,
        description: agent.description,
        capabilities: agent.capabilities || ["chat"],
        gateway_id: pluginConfig!.gatewayId,
        gateway_url: pluginConfig!.gatewayUrl,
        enrolled_at,
        verification_hash,
      };
    });

    sendJson(res, 200, { agents });
    return true;
  }

  // Not our path - let other plugins handle it
  return false;
}

/**
 * Check if a message is a Krill verify request
 * Supports both JSON format and special message format
 */
function parseVerifyRequest(text: string): { challenge: string; timestamp: number } | null {
  // Try JSON format
  try {
    const parsed = JSON.parse(text);
    if (parsed.type === "ai.krill.verify.request" && parsed.content?.challenge) {
      return {
        challenge: parsed.content.challenge,
        timestamp: parsed.content.timestamp || Math.floor(Date.now() / 1000),
      };
    }
    if (parsed.challenge) {
      return {
        challenge: parsed.challenge,
        timestamp: parsed.timestamp || Math.floor(Date.now() / 1000),
      };
    }
  } catch {}

  // Try special format: KRILL_VERIFY:challenge:timestamp
  const match = text.match(/^KRILL_VERIFY:([a-zA-Z0-9-]+):?(\d+)?$/);
  if (match) {
    return {
      challenge: match[1],
      timestamp: match[2] ? parseInt(match[2]) : Math.floor(Date.now() / 1000),
    };
  }

  return null;
}

/**
 * Generate verify response text
 */
function generateVerifyResponseText(challenge: string, agentConfig: KrillConfig): string {
  const agent = agentConfig.agents?.[0];
  const response = {
    type: "ai.krill.verify.response",
    content: {
      challenge,
      verified: true,
      agent: agent ? {
        mxid: agent.mxid,
        display_name: agent.displayName,
        gateway_id: agentConfig.gatewayId,
        capabilities: agent.capabilities || ["chat"],
        status: "online",
      } : null,
      responded_at: Math.floor(Date.now() / 1000),
    },
  };
  return JSON.stringify(response);
}

// Krill API endpoint for enrollment
const KRILL_API_URL = "https://api.krillbot.app";
const DEFAULT_REGISTRY_ROOM = "#krill-agents:matrix.krillbot.app";
const DEFAULT_REGISTRY_ROOM_ID = "!XMY8mTsfa81Wr59NIfVb3IfDD0NkJFVbdzi8nFf1ElE";

/**
 * Get Matrix access token from config
 */
function getMatrixCredentials(api: ClawdbotPluginApi): { homeserver: string; userId: string; password: string } | null {
  const matrixConfig = (api.config as any)?.channels?.matrix;
  if (!matrixConfig?.homeserver || !matrixConfig?.userId) {
    return null;
  }
  return {
    homeserver: matrixConfig.homeserver,
    userId: matrixConfig.userId,
    password: matrixConfig.password,
  };
}

/**
 * Login to Matrix and get access token
 */
async function matrixLogin(homeserver: string, userId: string, password: string): Promise<string | null> {
  try {
    const response = await fetch(`${homeserver}/_matrix/client/v3/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "m.login.password",
        user: userId,
        password: password,
      }),
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    return data.access_token;
  } catch (e) {
    return null;
  }
}

/**
 * Auto-enroll agent via Krill API + Matrix REST
 * 1. Login to Matrix
 * 2. Join registry room
 * 3. Submit state event
 */
async function autoEnrollAgent(api: ClawdbotPluginApi, config: KrillConfig): Promise<void> {
  const agent = config.agents?.[0];
  if (!agent) {
    api.logger.warn("[krill-enrollment] No agent configured for auto-enrollment");
    return;
  }

  api.logger.info(`[krill-enrollment] Starting auto-enrollment for ${agent.mxid}...`);

  try {
    // Step 1: Get Matrix credentials from config
    const creds = getMatrixCredentials(api);
    if (!creds) {
      api.logger.warn("[krill-enrollment] Matrix credentials not found in config");
      return;
    }

    // Step 2: Login to Matrix
    api.logger.info(`[krill-enrollment] Logging in to Matrix...`);
    const token = await matrixLogin(creds.homeserver, creds.userId, creds.password);
    if (!token) {
      api.logger.warn("[krill-enrollment] Matrix login failed");
      return;
    }

    const homeserver = creds.homeserver;
    const roomId = config.agentsRoomId || DEFAULT_REGISTRY_ROOM_ID;
    
    // Step 3: Join registry room
    api.logger.info(`[krill-enrollment] Joining registry room...`);
    try {
      await fetch(`${homeserver}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
    } catch (e) {
      // Ignore - might already be joined
    }

    // Step 4: Check if already enrolled with correct data
    api.logger.info(`[krill-enrollment] Checking existing enrollment...`);
    try {
      const stateResponse = await fetch(
        `${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/ai.krill.agent/${encodeURIComponent(agent.mxid)}`,
        { headers: { "Authorization": `Bearer ${token}` } }
      );
      
      if (stateResponse.ok) {
        const existing = await stateResponse.json();
        // Check if enrolled with correct gateway_id and a valid verification_hash
        if (existing.gateway_id === config.gatewayId && existing.verification_hash) {
          api.logger.info(`[krill-enrollment] ✅ Already enrolled: ${agent.mxid}`);
          return;
        }
      }
    } catch (e) {
      // Not enrolled yet - continue
    }

    // Step 5: Generate enrollment data (use gatewaySecret directly as verification_hash for compatibility)
    const enrolled_at = Math.floor(Date.now() / 1000);
    const enrollmentContent = {
      gateway_id: config.gatewayId,
      gateway_url: config.gatewayUrl || homeserver,
      display_name: agent.displayName,
      description: agent.description || `${agent.displayName} - Krill Network Agent`,
      capabilities: agent.capabilities || ["chat", "senses", "location"],
      enrolled_at,
      verification_hash: config.gatewaySecret, // Use secret directly for HMAC compatibility
    };

    // Step 6: Submit state event to Matrix
    api.logger.info(`[krill-enrollment] Submitting enrollment to Matrix...`);
    const stateResponse = await fetch(
      `${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/ai.krill.agent/${encodeURIComponent(agent.mxid)}`,
      {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(enrollmentContent),
      }
    );

    if (!stateResponse.ok) {
      const error = await stateResponse.text();
      api.logger.warn(`[krill-enrollment] Matrix state event failed: ${error}`);
      return;
    }

    const result = await stateResponse.json();
    api.logger.info(`[krill-enrollment] ✅ Agent enrolled: ${agent.mxid} (event: ${result.event_id})`);

  } catch (error) {
    api.logger.warn(`[krill-enrollment] Auto-enrollment failed: ${error}`);
  }
}

const plugin = {
  id: "krill-enrollment",
  name: "Krill Enrollment",
  description: "Krill agent enrollment and verification for OpenClaw gateways",
  configSchema,
  uiHints: {
    gatewaySecret: { label: "Gateway Secret", sensitive: true },
    gatewayId: { label: "Gateway ID", placeholder: "clawdbot-001" },
    gatewayUrl: { label: "Gateway URL", placeholder: "https://gateway.example.com" },
    agentsRoomId: { label: "Registry Room", placeholder: "#krill-agents:matrix.krillbot.app" },
  },

  register(api: ClawdbotPluginApi) {
    logger = api.logger;
    pluginApi = api;
    
    // Get plugin config
    const config = api.config?.plugins?.entries?.["krill-enrollment"]?.config as KrillConfig | undefined;
    if (config) {
      pluginConfig = config;
      api.logger.info(`Krill enrollment plugin loaded for gateway: ${config.gatewayId}`);
      api.logger.info(`Krill agents configured: ${config.agents?.length || 0}`);
      
      // Schedule auto-enrollment after Matrix is ready (with delay to ensure connection)
      setTimeout(() => {
        autoEnrollAgent(api, config).catch((e) => {
          api.logger.warn(`[krill-enrollment] Auto-enrollment error: ${e}`);
        });
      }, 10000); // Wait 10s for Matrix to connect
      
    } else {
      api.logger.warn("Krill enrollment plugin: no config found");
    }

    // Register HTTP handler
    api.registerHttpHandler(handleKrillRequest);

    // Register auto-reply command for verify requests
    // This intercepts messages before they reach the agent
    api.registerCommand?.({
      name: "krill-verify",
      description: "Handle Krill verification requests",
      acceptsArgs: true,
      requireAuth: false, // Allow anyone to verify
      handler: (ctx) => {
        if (!pluginConfig) {
          return { text: JSON.stringify({ type: "ai.krill.verify.response", content: { verified: false, error: "NOT_CONFIGURED" } }) };
        }

        const verifyReq = parseVerifyRequest(ctx.args || "");
        if (!verifyReq) {
          return { text: JSON.stringify({ type: "ai.krill.verify.response", content: { verified: false, error: "INVALID_REQUEST" } }) };
        }

        return { text: generateVerifyResponseText(verifyReq.challenge, pluginConfig) };
      },
    });

    // Register CLI commands
    api.registerCli?.(({ program }) => {
      const krill = program.command("krill").description("Krill enrollment commands");

      krill
        .command("enroll <mxid>")
        .description("Generate enrollment state event for an agent")
        .option("-n, --name <name>", "Display name")
        .option("-d, --description <desc>", "Description")
        .action(async (mxid: string, opts: any) => {
          if (!pluginConfig) {
            console.error("Krill plugin not configured");
            return;
          }

          const enrolled_at = Math.floor(Date.now() / 1000);
          const verification_hash = generateHash(
            pluginConfig.gatewaySecret,
            mxid,
            pluginConfig.gatewayId,
            enrolled_at
          );

          const stateEvent = {
            type: "ai.krill.agent",
            state_key: mxid,
            content: {
              gateway_id: pluginConfig.gatewayId,
              gateway_url: pluginConfig.gatewayUrl,
              display_name: opts.name || mxid.split(":")[0].slice(1),
              description: opts.description || "",
              capabilities: ["chat", "senses"],
              enrolled_at,
              verification_hash,
            },
          };

          console.log("\n📋 Matrix State Event:\n");
          console.log(JSON.stringify(stateEvent, null, 2));
        });

      krill.command("status").description("Show Krill plugin status").action(() => {
        if (!pluginConfig) {
          console.error("Krill plugin not configured");
          return;
        }
        console.log(`\n🔑 Gateway ID: ${pluginConfig.gatewayId}`);
        console.log(`🌐 Gateway URL: ${pluginConfig.gatewayUrl || "(not set)"}`);
        console.log(`🤖 Agents: ${pluginConfig.agents?.length || 0}`);
        pluginConfig.agents?.forEach((a, i) => {
          console.log(`   ${i + 1}. ${a.displayName} (${a.mxid})`);
        });
      });

      krill.command("test-verify <challenge>").description("Test verification response").action((challenge: string) => {
        if (!pluginConfig) {
          console.error("Krill plugin not configured");
          return;
        }
        console.log("\n📋 Verify Response:\n");
        console.log(generateVerifyResponseText(challenge, pluginConfig));
      });
    }, { commands: ["krill"] });
  },
};

export default plugin;
