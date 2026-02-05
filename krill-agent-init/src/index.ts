/**
 * Krill Agent Init Plugin
 *
 * Handles agent enrollment to the Krill Network on boot:
 *   1. Joins the registry room
 *   2. Publishes ai.krill.agent state event
 *   3. Registers gateway with Krill API
 *
 * Provisioning (creating Matrix user, getting credentials) is handled
 * by the setup scripts BEFORE the gateway starts. This plugin only
 * does enrollment with existing credentials.
 */

import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import crypto from "crypto";

// ── Config Schema ────────────────────────────────────────────────────

const configSchema = {
  type: "object",
  properties: {
    agentName: {
      type: "string",
      description: "Agent username (lowercase, alphanumeric)",
    },
    displayName: {
      type: "string",
      description: "Human-readable display name",
    },
    description: {
      type: "string",
      description: "Short description of the agent",
    },
    capabilities: {
      type: "array",
      items: { type: "string" },
      description: "Agent capabilities (e.g., chat, senses)",
    },
    model: {
      type: "string",
      description: "LLM model identifier",
    },
    krillApiUrl: {
      type: "string",
      description: "Krill API URL (e.g., https://api.krillbot.network)",
    },
    krillApiKey: {
      type: "string",
      description: "API key for Krill API authentication",
    },
    registryRoomId: {
      type: "string",
      description: "Matrix room ID for agent registry (optional)",
    },
    gatewayId: {
      type: "string",
      description: "Gateway ID (set by setup script)",
    },
    gatewaySecret: {
      type: "string",
      description: "Gateway secret (set by setup script)",
    },
    agent: {
      type: "object",
      description: "Agent identity (set by setup script)",
      properties: {
        mxid: { type: "string" },
        displayName: { type: "string" },
        description: { type: "string" },
        capabilities: { type: "array", items: { type: "string" } },
      },
      required: ["mxid", "displayName"],
    },
  },
  required: ["gatewayId", "gatewaySecret", "agent"],
};

interface AgentInitConfig {
  agentName?: string;
  displayName: string;
  description?: string;
  capabilities?: string[];
  model?: string;
  krillApiUrl?: string;
  krillApiKey?: string;
  registryRoomId?: string;
  gatewayId: string;
  gatewaySecret: string;
  agent: {
    mxid: string;
    displayName: string;
    description?: string;
    capabilities?: string[];
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function generateVerificationHash(
  secret: string,
  agentMxid: string,
  gatewayId: string,
  enrolledAt: number
): string {
  const message = `${agentMxid}|${gatewayId}|${enrolledAt}`;
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

/**
 * Enroll agent in the registry room via Matrix state event.
 */
async function enrollInRegistry(
  api: ClawdbotPluginApi,
  config: AgentInitConfig,
  matrixHomeserver: string,
  accessToken: string
): Promise<boolean> {
  const { agent, gatewayId, gatewaySecret, registryRoomId } = config;

  if (!registryRoomId) {
    api.logger.info("[krill-init] No registry room configured — skipping");
    return false;
  }

  try {
    // Join registry room
    api.logger.info(`[krill-init] Joining registry room ${registryRoomId}...`);
    await fetch(
      `${matrixHomeserver}/_matrix/client/v3/join/${encodeURIComponent(registryRoomId)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      }
    );

    // Check if already enrolled
    const stateRes = await fetch(
      `${matrixHomeserver}/_matrix/client/v3/rooms/${encodeURIComponent(registryRoomId)}/state/ai.krill.agent/${encodeURIComponent(agent.mxid)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (stateRes.ok) {
      const existing = (await stateRes.json()) as any;
      if (existing.gateway_id === gatewayId) {
        api.logger.info(`[krill-init] ✅ Already enrolled: ${agent.mxid}`);
        return true;
      }
    }

    // Publish enrollment state event
    const enrolledAt = Math.floor(Date.now() / 1000);
    const verificationHash = generateVerificationHash(
      gatewaySecret,
      agent.mxid,
      gatewayId,
      enrolledAt
    );

    const stateContent = {
      gateway_id: gatewayId,
      display_name: agent.displayName,
      description: agent.description || config.description || `${agent.displayName} - Krill Network Agent`,
      capabilities: agent.capabilities || config.capabilities || ["chat"],
      enrolled_at: enrolledAt,
      verification_hash: verificationHash,
    };

    const enrollRes = await fetch(
      `${matrixHomeserver}/_matrix/client/v3/rooms/${encodeURIComponent(registryRoomId)}/state/ai.krill.agent/${encodeURIComponent(agent.mxid)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(stateContent),
      }
    );

    if (enrollRes.ok) {
      api.logger.info(`[krill-init] ✅ Enrolled in registry: ${agent.mxid}`);
      return true;
    } else {
      const error = await enrollRes.text();
      api.logger.warn(`[krill-init] Registry enrollment failed: ${error}`);
      return false;
    }
  } catch (error: any) {
    api.logger.warn(`[krill-init] Registry enrollment error: ${error.message}`);
    return false;
  }
}

/**
 * Register gateway with the Krill API.
 */
async function registerGateway(
  api: ClawdbotPluginApi,
  config: AgentInitConfig
): Promise<boolean> {
  const { gatewayId, gatewaySecret, krillApiUrl } = config;

  if (!krillApiUrl) return false;

  try {
    const res = await fetch(`${krillApiUrl}/v1/gateways/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-gateway-id": gatewayId,
        "x-gateway-secret": gatewaySecret,
      },
      body: JSON.stringify({
        serverIp: "0.0.0.0",
        version: "1.0.0",
        hostname: gatewayId,
      }),
    });

    if (res.ok) {
      api.logger.info(`[krill-init] ✅ Gateway registered: ${gatewayId}`);
      return true;
    }
  } catch (error: any) {
    api.logger.warn(`[krill-init] Gateway registration failed: ${error.message}`);
  }

  return false;
}

// ── Plugin ───────────────────────────────────────────────────────────

const plugin = {
  id: "krill-agent-init",
  name: "Krill Agent Init",
  description: "Enrollment of agents to the Krill Network",
  configSchema,

  register(api: ClawdbotPluginApi) {
    const config = api.config?.plugins?.entries?.["krill-agent-init"]?.config as
      | AgentInitConfig
      | undefined;

    if (!config) {
      api.logger.warn("[krill-init] No config found — plugin disabled");
      return;
    }

    // Validate required fields
    const missing: string[] = [];
    if (!config.gatewayId) missing.push("gatewayId");
    if (!config.gatewaySecret) missing.push("gatewaySecret");
    if (!config.agent?.mxid) missing.push("agent.mxid");
    if (!config.agent?.displayName) missing.push("agent.displayName");

    if (missing.length > 0) {
      api.logger.warn(`[krill-init] ⚠️ Missing required config: ${missing.join(", ")} — skipping enrollment`);
      return;
    }

    api.logger.info(`[krill-init] Initializing: "${config.agent.displayName}" (${config.agent.mxid})`);

    const matrixConfig = (api.config as any)?.channels?.matrix;

    // Schedule enrollment after Matrix connects
    setTimeout(async () => {
      // Register gateway with API (agent already in DB via /v1/provision/agent)
      if (config.krillApiUrl) {
        await registerGateway(api, config);
      } else {
        api.logger.info("[krill-init] No krillApiUrl — skipping API registration");
      }

      api.logger.info("[krill-init] ✅ Init complete");
    }, 10000);
  },
};

export default plugin;
