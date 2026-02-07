/**
 * Krill Agent Init Plugin
 *
 * Registers the gateway with the Krill API on startup.
 * 
 * Provisioning (creating Matrix user, getting credentials) is handled
 * by setup-gateway-node.sh BEFORE the gateway starts.
 */

import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";

// ── Config Schema ────────────────────────────────────────────────────

const configSchema = {
  type: "object",
  properties: {
    gatewayId: {
      type: "string",
      description: "Gateway ID (set by setup script)",
    },
    gatewaySecret: {
      type: "string",
      description: "Gateway secret (set by setup script)",
    },
    krillApiUrl: {
      type: "string",
      description: "Krill API URL (e.g., https://api.krillbot.network)",
    },
    agent: {
      type: "object",
      description: "Agent identity (set by setup script)",
      properties: {
        mxid: { type: "string" },
        displayName: { type: "string" },
      },
      required: ["mxid", "displayName"],
    },
  },
  required: ["gatewayId", "gatewaySecret", "agent"],
};

interface AgentInitConfig {
  gatewayId: string;
  gatewaySecret: string;
  krillApiUrl?: string;
  agent: {
    mxid: string;
    displayName: string;
  };
}

// ── Plugin ───────────────────────────────────────────────────────────

const plugin = {
  id: "krill-agent-init",
  name: "Krill Agent Init",
  description: "Registers gateway with Krill API on startup",
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
    if (!config.gatewayId || !config.gatewaySecret || !config.agent?.mxid) {
      api.logger.warn("[krill-init] Missing required config — skipping");
      return;
    }

    api.logger.info(`[krill-init] Agent: ${config.agent.displayName} (${config.agent.mxid})`);

    // Register gateway with API after startup
    if (config.krillApiUrl) {
      setTimeout(async () => {
        try {
          const res = await fetch(`${config.krillApiUrl}/v1/gateways/register`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-gateway-id": config.gatewayId,
              "x-gateway-secret": config.gatewaySecret,
            },
            body: JSON.stringify({
              serverIp: "0.0.0.0",
              version: "1.0.0",
              hostname: config.gatewayId,
            }),
          });

          if (res.ok) {
            api.logger.info(`[krill-init] ✅ Gateway registered: ${config.gatewayId}`);
          } else {
            api.logger.warn(`[krill-init] Gateway registration failed: ${res.status}`);
          }
        } catch (error: any) {
          api.logger.warn(`[krill-init] Gateway registration error: ${error.message}`);
        }
      }, 5000);
    }
  },
};

export default plugin;
