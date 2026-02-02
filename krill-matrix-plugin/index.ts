import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";

import { matrixPlugin } from "./src/channel.js";
import { setMatrixRuntime } from "./src/runtime.js";
import { initKrillInterceptor } from "./src/krill/interceptor.js";

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
  description: "Krill-enabled Matrix channel plugin with protocol interception",
  configSchema,
  uiHints: {
    gatewaySecret: { label: "Gateway Secret", sensitive: true },
    gatewayId: { label: "Gateway ID" },
  },
  register(api: ClawdbotPluginApi) {
    setMatrixRuntime(api.runtime);
    
    // Initialize Krill interceptor with config
    const krillConfig = api.config?.plugins?.entries?.["krill-matrix"]?.config as any;
    if (krillConfig?.gatewayId && krillConfig?.gatewaySecret) {
      initKrillInterceptor({
        gatewayId: krillConfig.gatewayId,
        gatewaySecret: krillConfig.gatewaySecret,
        agents: krillConfig.agents || [],
        pairingsPath: krillConfig.pairingsPath,
      });
      api.logger.info(`Krill Matrix plugin initialized for gateway: ${krillConfig.gatewayId}`);
    } else {
      api.logger.warn("Krill Matrix plugin: missing gatewayId or gatewaySecret config");
    }
    
    api.registerChannel({ plugin: matrixPlugin });
  },
};

export default plugin;
