var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var import_crypto = __toESM(require("crypto"), 1);
var configSchema = {
  type: "object",
  properties: {
    gatewayId: {
      type: "string",
      description: "Unique identifier for this gateway"
    },
    gatewaySecret: {
      type: "string",
      description: "Secret key for verification hashes"
    },
    registryRoomId: {
      type: "string",
      description: "Matrix room ID for agent registry"
    },
    krillApiUrl: {
      type: "string",
      description: "Krill API URL (e.g., https://api.krillbot.network)"
    },
    agent: {
      type: "object",
      properties: {
        mxid: { type: "string" },
        displayName: { type: "string" },
        description: { type: "string" },
        capabilities: { type: "array", items: { type: "string" } }
      },
      required: ["mxid", "displayName"]
    }
  },
  required: ["gatewayId", "gatewaySecret", "agent"]
};
function generateVerificationHash(secret, agentMxid, gatewayId, enrolledAt) {
  const message = `${agentMxid}|${gatewayId}|${enrolledAt}`;
  return import_crypto.default.createHmac("sha256", secret).update(message).digest("hex");
}
async function enrollViaMatrix(api, config, matrixHomeserver, accessToken) {
  const { agent, gatewayId, gatewaySecret, registryRoomId } = config;
  if (!registryRoomId) {
    api.logger.warn("[krill-init] No registryRoomId configured, skipping Matrix enrollment");
    return false;
  }
  try {
    api.logger.info(`[krill-init] Joining registry room...`);
    await fetch(`${matrixHomeserver}/_matrix/client/v3/join/${encodeURIComponent(registryRoomId)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: "{}"
    });
    const stateRes = await fetch(
      `${matrixHomeserver}/_matrix/client/v3/rooms/${encodeURIComponent(registryRoomId)}/state/ai.krill.agent/${encodeURIComponent(agent.mxid)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (stateRes.ok) {
      const existing = await stateRes.json();
      if (existing.gateway_id === gatewayId) {
        api.logger.info(`[krill-init] \u2705 Already enrolled: ${agent.mxid}`);
        return true;
      }
    }
    const enrolledAt = Math.floor(Date.now() / 1e3);
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
      verification_hash: verificationHash
    };
    api.logger.info(`[krill-init] Enrolling ${agent.mxid}...`);
    const enrollRes = await fetch(
      `${matrixHomeserver}/_matrix/client/v3/rooms/${encodeURIComponent(registryRoomId)}/state/ai.krill.agent/${encodeURIComponent(agent.mxid)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(stateContent)
      }
    );
    if (enrollRes.ok) {
      api.logger.info(`[krill-init] \u2705 Enrolled: ${agent.mxid}`);
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
async function enrollViaApi(api, config) {
  const { agent, gatewayId, krillApiUrl } = config;
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
        display_name: agent.displayName,
        description: agent.description,
        capabilities: agent.capabilities || ["chat"]
      })
    });
    if (res.ok) {
      api.logger.info(`[krill-init] \u2705 Registered with Krill API`);
      return true;
    }
  } catch (error) {
    api.logger.warn(`[krill-init] API enrollment failed: ${error}`);
  }
  return false;
}
var plugin = {
  id: "krill-agent-init",
  name: "Krill Agent Init",
  description: "Auto-enrollment of agent to Krill Network on startup",
  configSchema,
  register(api) {
    const config = api.config?.plugins?.entries?.["krill-agent-init"]?.config;
    if (!config) {
      api.logger.warn("[krill-init] No config found, plugin disabled");
      return;
    }
    api.logger.info(`[krill-init] Initializing for gateway: ${config.gatewayId}`);
    const matrixConfig = api.config?.channels?.matrix;
    setTimeout(async () => {
      if (matrixConfig?.homeserver && matrixConfig?.accessToken) {
        await enrollViaMatrix(api, config, matrixConfig.homeserver, matrixConfig.accessToken);
      }
      if (config.krillApiUrl) {
        await enrollViaApi(api, config);
      }
    }, 1e4);
    api.logger.info("[krill-init] \u2705 Agent init plugin registered");
  }
};
var index_default = plugin;
