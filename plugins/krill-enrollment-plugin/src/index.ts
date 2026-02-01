import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import crypto from "crypto";

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

interface EnrollRequest {
  agent_mxid: string;
  display_name: string;
  description?: string;
  capabilities?: string[];
}

let pluginConfig: KrillConfig | null = null;

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
 * Handle POST /krill/verify
 * Validates that an agent hash is authentic
 */
async function handleVerify(req: any, res: any): Promise<void> {
  if (!pluginConfig) {
    res.status(500).json({ valid: false, error: "Plugin not configured" });
    return;
  }

  try {
    const body: VerifyRequest = req.body;
    const { agent_mxid, gateway_id, verification_hash, enrolled_at } = body;

    // Check gateway_id matches
    if (gateway_id !== pluginConfig.gatewayId) {
      res.json({ valid: false, error: "Gateway ID mismatch" });
      return;
    }

    // Recalculate hash
    const expectedHash = generateHash(
      pluginConfig.gatewaySecret,
      agent_mxid,
      gateway_id,
      enrolled_at
    );

    if (verification_hash === expectedHash) {
      // Find agent in config
      const agent = pluginConfig.agents?.find((a) => a.mxid === agent_mxid);
      res.json({
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
      res.json({ valid: false, error: "Hash mismatch" });
    }
  } catch (error) {
    res.status(400).json({ valid: false, error: "Invalid request" });
  }
}

/**
 * Handle POST /krill/enroll
 * Enrolls an agent and returns the verification hash
 */
async function handleEnroll(req: any, res: any): Promise<void> {
  if (!pluginConfig) {
    res.status(500).json({ success: false, error: "Plugin not configured" });
    return;
  }

  try {
    const body: EnrollRequest = req.body;
    const { agent_mxid, display_name, description, capabilities } = body;

    const enrolled_at = Math.floor(Date.now() / 1000);
    const verification_hash = generateHash(
      pluginConfig.gatewaySecret,
      agent_mxid,
      pluginConfig.gatewayId,
      enrolled_at
    );

    // Return the enrollment data (Matrix state event should be sent separately)
    res.json({
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
    res.status(400).json({ success: false, error: "Invalid request" });
  }
}

/**
 * Handle GET /krill/agents
 * Lists all enrolled agents with their hashes
 */
async function handleListAgents(req: any, res: any): Promise<void> {
  if (!pluginConfig) {
    res.status(500).json({ error: "Plugin not configured" });
    return;
  }

  const agents = (pluginConfig.agents || []).map((agent) => {
    const enrolled_at = Math.floor(Date.now() / 1000); // Would be stored in real impl
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

  res.json({ agents });
}

/**
 * HTTP request handler
 */
function handleHttpRequest(req: any, res: any): boolean {
  const { method, path } = req;

  if (path === "/krill/verify" && method === "POST") {
    handleVerify(req, res);
    return true;
  }

  if (path === "/krill/enroll" && method === "POST") {
    handleEnroll(req, res);
    return true;
  }

  if (path === "/krill/agents" && method === "GET") {
    handleListAgents(req, res);
    return true;
  }

  return false;
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
  },

  register(api: ClawdbotPluginApi) {
    // Get plugin config
    const config = api.config?.plugins?.entries?.["krill-enrollment"]?.config as KrillConfig | undefined;
    if (config) {
      pluginConfig = config;
      api.logger.info(`Krill enrollment plugin loaded for gateway: ${config.gatewayId}`);
    } else {
      api.logger.warn("Krill enrollment plugin: no config found");
    }

    // Register HTTP handlers
    api.registerHttpHandler(handleHttpRequest);

    // Register CLI command for enrollment
    api.registerCli?.(({ program }) => {
      const krill = program.command("krill").description("Krill enrollment commands");

      krill
        .command("enroll <mxid>")
        .description("Enroll an agent and get the Matrix state event")
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

          console.log("\nMatrix State Event to publish:\n");
          console.log(JSON.stringify(stateEvent, null, 2));
          console.log("\nUse this command to publish to Matrix:");
          console.log(`curl -X PUT -H "Authorization: Bearer \$TOKEN" \\`);
          console.log(`  -H "Content-Type: application/json" \\`);
          console.log(`  -d '${JSON.stringify(stateEvent.content)}' \\`);
          console.log(`  "https://matrix.example.com/_matrix/client/v3/rooms/\$ROOM_ID/state/${stateEvent.type}/${encodeURIComponent(mxid)}"`);
        });

      krill.command("verify-hash").description("Test hash verification").action(() => {
        if (!pluginConfig) {
          console.error("Krill plugin not configured");
          return;
        }
        console.log(`Gateway ID: ${pluginConfig.gatewayId}`);
        console.log(`Configured agents: ${pluginConfig.agents?.length || 0}`);
      });
    }, { commands: ["krill"] });
  },
};

export default plugin;
