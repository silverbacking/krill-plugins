import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";

import { matrixPlugin } from "./src/channel.js";
import { setMatrixRuntime } from "./src/runtime.js";
import { initKrillInterceptor } from "./src/krill/interceptor.js";
import { SynapseAdminClient, provisionAgents } from "./src/admin/index.js";

// Config interface
interface KrillMatrixConfig {
  gatewayId: string;
  gatewaySecret: string;
  adminToken?: string;
  autoProvision?: boolean;
  agents?: Array<{
    mxid: string;
    displayName?: string;
    capabilities?: string[];
  }>;
  pairingsPath?: string;
}

// Config schema for Krill settings
const configSchema = {
  type: "object",
  properties: {
    gatewayId: {
      type: "string",
      description: "Krill gateway identifier",
    },
    gatewaySecret: {
      type: "string",
      description: "Secret key for Krill operations",
    },
    adminToken: {
      type: "string",
      description: "Synapse Admin API token for auto-provisioning",
    },
    autoProvision: {
      type: "boolean",
      description: "Auto-create agents on startup",
      default: false,
    },
    agents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          mxid: { type: "string" },
          displayName: { type: "string" },
          capabilities: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

const plugin = {
  id: "krill-matrix",
  name: "Matrix (Krill)",
  version: "0.2.0",
  description: "Krill-enabled Matrix channel plugin with protocol interception and auto-provisioning",
  configSchema,
  uiHints: {
    gatewaySecret: { label: "Gateway Secret", sensitive: true },
    gatewayId: { label: "Gateway ID" },
    adminToken: { label: "Synapse Admin Token", sensitive: true },
    autoProvision: { label: "Auto-provision Agents" },
  },

  async register(api: ClawdbotPluginApi) {
    setMatrixRuntime(api.runtime);
    
    // Get plugin config
    const krillConfig = api.config?.plugins?.entries?.["krill-matrix"]?.config as KrillMatrixConfig | undefined;
    
    if (!krillConfig?.gatewayId || !krillConfig?.gatewaySecret) {
      api.logger.warn("Krill Matrix plugin: missing gatewayId or gatewaySecret config");
      api.registerChannel({ plugin: matrixPlugin });
      return;
    }

    // Auto-provision agents if enabled
    if (krillConfig.autoProvision && krillConfig.adminToken && krillConfig.agents?.length) {
      const homeserver = api.config?.channels?.matrix?.homeserver;
      
      if (homeserver) {
        api.logger.info(`[krill-matrix] Auto-provisioning ${krillConfig.agents.length} agents...`);
        
        try {
          const adminClient = new SynapseAdminClient({
            homeserver,
            adminToken: krillConfig.adminToken,
          });

          const provisionedAgents = await provisionAgents(
            adminClient,
            krillConfig.agents.map(a => ({
              mxid: a.mxid,
              displayName: a.displayName || a.mxid.split(':')[0].slice(1),
              capabilities: a.capabilities,
            }))
          );

          for (const agent of provisionedAgents) {
            api.logger.info(
              `[krill-matrix] Agent ${agent.mxid}: ${agent.created ? 'created' : 'verified'}`
            );
          }

          api.logger.info(`[krill-matrix] Auto-provisioning complete: ${provisionedAgents.length} agents ready`);
        } catch (error) {
          api.logger.error(`[krill-matrix] Auto-provisioning failed:`, error);
          // Continue anyway - agents might already exist
        }
      } else {
        api.logger.warn("[krill-matrix] Cannot auto-provision: no homeserver configured");
      }
    }

    // Initialize Krill interceptor
    initKrillInterceptor({
      gatewayId: krillConfig.gatewayId,
      gatewaySecret: krillConfig.gatewaySecret,
      agents: krillConfig.agents || [],
      pairingsPath: krillConfig.pairingsPath,
    });
    
    api.logger.info(`[krill-matrix] Plugin initialized for gateway: ${krillConfig.gatewayId}`);
    
    // Register the Matrix channel
    api.registerChannel({ plugin: matrixPlugin });
  },
};

export default plugin;
