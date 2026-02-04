/**
 * Krill Agent Init Plugin
 * 
 * Handles one-time agent enrollment to the Krill Network:
 * 1. Creates Matrix user (if needed)
 * 2. Joins the registry room
 * 3. Publishes ai.krill.agent state event
 * 4. Registers with the Krill API
 * 
 * This plugin runs once on startup and ensures the agent is enrolled.
 */

import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import crypto from "crypto";

const configSchema = {
  type: "object",
  properties: {
    gatewayId: {
      type: "string",
      description: "Unique identifier for this gateway",
    },
    gatewaySecret: {
      type: "string",
      description: "Secret key for verification hashes",
    },
    registryRoomId: {
      type: "string",
      description: "Matrix room ID for agent registry",
    },
    krillApiUrl: {
      type: "string",
      description: "Krill API URL (e.g., https://api.krillbot.network)",
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
  },
  required: ["gatewayId", "gatewaySecret", "agent"],
};

interface AgentInitConfig {
  gatewayId: string;
  gatewaySecret: string;
  registryRoomId?: string;
  krillApiUrl?: string;
  agent: {
    mxid: string;
    displayName: string;
    description?: string;
    capabilities?: string[];
  };
}

/**
 * Generate verification hash for enrollment
 */
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
 * Enroll agent via Matrix state event
 */
async function enrollViaMatrix(
  api: ClawdbotPluginApi,
  config: AgentInitConfig,
  matrixHomeserver: string,
  accessToken: string
): Promise<boolean> {
  const { agent, gatewayId, gatewaySecret, registryRoomId } = config;
  
  if (!registryRoomId) {
    api.logger.warn("[krill-init] No registryRoomId configured, skipping Matrix enrollment");
    return false;
  }
  
  try {
    // Join registry room
    api.logger.info(`[krill-init] Joining registry room...`);
    await fetch(`${matrixHomeserver}/_matrix/client/v3/join/${encodeURIComponent(registryRoomId)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    
    // Check if already enrolled
    const stateRes = await fetch(
      `${matrixHomeserver}/_matrix/client/v3/rooms/${encodeURIComponent(registryRoomId)}/state/ai.krill.agent/${encodeURIComponent(agent.mxid)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    if (stateRes.ok) {
      const existing = await stateRes.json();
      if (existing.gateway_id === gatewayId) {
        api.logger.info(`[krill-init] ✅ Already enrolled: ${agent.mxid}`);
        return true;
      }
    }
    
    // Enroll
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
      description: agent.description || `${agent.displayName} - Krill Network Agent`,
      capabilities: agent.capabilities || ["chat"],
      enrolled_at: enrolledAt,
      verification_hash: verificationHash,
    };
    
    api.logger.info(`[krill-init] Enrolling ${agent.mxid}...`);
    
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
      api.logger.info(`[krill-init] ✅ Enrolled: ${agent.mxid}`);
      return true;
    } else {
      const error = await enrollRes.text();
      api.logger.warn(`[krill-init] Enrollment failed: ${error}`);
      return false;
    }
  } catch (error) {
    api.logger.warn(`[krill-init] Matrix enrollment error: ${error}`);
    return false;
  }
}

/**
 * Register gateway via Krill API
 */
async function registerGateway(
  api: ClawdbotPluginApi,
  config: AgentInitConfig
): Promise<boolean> {
  const { gatewayId, gatewaySecret, krillApiUrl } = config;
  
  if (!krillApiUrl) {
    return false;
  }
  
  try {
    // Generate a public key from the secret (deterministic)
    const publicKey = crypto.createHash("sha256").update(gatewaySecret).digest("hex");
    
    const res = await fetch(`${krillApiUrl}/v1/gateways/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gateway_id: gatewayId,
        owner_id: null, // No owner for self-registered gateways
        public_key: publicKey,
        capabilities: ["agent-hosting", "chat"],
      }),
    });
    
    if (res.ok) {
      api.logger.info(`[krill-init] ✅ Gateway registered: ${gatewayId}`);
      return true;
    } else {
      const error = await res.text();
      api.logger.warn(`[krill-init] Gateway registration response: ${error}`);
      // May already exist, which is fine
      return true;
    }
  } catch (error) {
    api.logger.warn(`[krill-init] Gateway registration failed: ${error}`);
  }
  
  return false;
}

/**
 * Enroll agent via Krill API
 */
async function enrollViaApi(
  api: ClawdbotPluginApi,
  config: AgentInitConfig
): Promise<boolean> {
  const { agent, gatewayId, gatewaySecret, krillApiUrl } = config;
  
  if (!krillApiUrl) {
    return false;
  }
  
  try {
    const res = await fetch(`${krillApiUrl}/v1/agents/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mxid: agent.mxid,
        gateway_id: gatewayId,
        gateway_secret: gatewaySecret,
        display_name: agent.displayName,
        description: agent.description,
        capabilities: agent.capabilities || ["chat"],
      }),
    });
    
    if (res.ok) {
      api.logger.info(`[krill-init] ✅ Agent registered with Krill API`);
      return true;
    }
  } catch (error) {
    api.logger.warn(`[krill-init] API enrollment failed: ${error}`);
  }
  
  return false;
}

const plugin = {
  id: "krill-agent-init",
  name: "Krill Agent Init",
  description: "Auto-enrollment of agent to Krill Network on startup",
  configSchema,
  
  register(api: ClawdbotPluginApi) {
    const config = api.config?.plugins?.entries?.["krill-agent-init"]?.config as AgentInitConfig | undefined;
    
    if (!config) {
      api.logger.warn("[krill-init] No config found, plugin disabled");
      return;
    }
    
    api.logger.info(`[krill-init] Initializing for gateway: ${config.gatewayId}`);
    
    // Get Matrix credentials
    const matrixConfig = (api.config as any)?.channels?.matrix;
    
    // Schedule enrollment after Matrix connects
    setTimeout(async () => {
      // 1. Register gateway first
      if (config.krillApiUrl) {
        await registerGateway(api, config);
      }
      
      // 2. Enroll agent via Matrix
      if (matrixConfig?.homeserver && matrixConfig?.accessToken) {
        await enrollViaMatrix(api, config, matrixConfig.homeserver, matrixConfig.accessToken);
      }
      
      // 3. Enroll agent via API
      if (config.krillApiUrl) {
        await enrollViaApi(api, config);
      }
    }, 10000); // Wait 10s for Matrix to connect
    
    api.logger.info("[krill-init] ✅ Agent init plugin registered");
  },
};

export default plugin;
