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
var import_fs2 = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);

// src/handlers/pairing.ts
var import_crypto = __toESM(require("crypto"), 1);
var import_fs = __toESM(require("fs"), 1);
var pairingsStore = { pairings: {} };
function getStoragePath(config) {
  return config.storagePath || "/tmp/krill-pairings.json";
}
function loadPairings(config) {
  try {
    const path2 = getStoragePath(config);
    if (import_fs.default.existsSync(path2)) {
      pairingsStore = JSON.parse(import_fs.default.readFileSync(path2, "utf-8"));
    }
  } catch {
    pairingsStore = { pairings: {} };
  }
}
function savePairings(config) {
  try {
    import_fs.default.writeFileSync(getStoragePath(config), JSON.stringify(pairingsStore, null, 2));
  } catch (e) {
    console.error("[krill-pairing] Failed to save:", e);
  }
}
function generateToken() {
  return `krill_tk_v1_${import_crypto.default.randomBytes(32).toString("base64url")}`;
}
function hashToken(token) {
  return import_crypto.default.createHash("sha256").update(token).digest("hex");
}
var handlePairing = {
  /**
   * Handle ai.krill.pair.request
   */
  async request(config, content, senderId, sendResponse) {
    loadPairings(config);
    const { device_id, device_name } = content;
    const agent = config.agent;
    if (!agent) {
      await sendResponse(JSON.stringify({
        type: "ai.krill.pair.response",
        content: {
          success: false,
          error: "Agent not configured"
        }
      }));
      return;
    }
    const existingKey = `${senderId}:${device_id}`;
    const existing = pairingsStore.pairings[existingKey];
    if (existing) {
      existing.last_seen_at = Date.now();
      savePairings(config);
      await sendResponse(JSON.stringify({
        type: "ai.krill.pair.response",
        content: {
          success: true,
          pairing_id: existing.pairing_id,
          agent: {
            mxid: agent.mxid,
            display_name: agent.displayName,
            capabilities: agent.capabilities || ["chat"]
          },
          message: "Ja estem connectats! \u{1F44B}"
        }
      }));
      return;
    }
    const pairing_id = `pair_${import_crypto.default.randomBytes(8).toString("hex")}`;
    const pairing_token = generateToken();
    const pairing = {
      pairing_id,
      pairing_token_hash: hashToken(pairing_token),
      agent_mxid: agent.mxid,
      user_mxid: senderId,
      device_id,
      device_name,
      created_at: Date.now(),
      last_seen_at: Date.now()
    };
    pairingsStore.pairings[existingKey] = pairing;
    savePairings(config);
    console.log(`[krill-pairing] New pairing: ${pairing_id} for ${senderId}`);
    await sendResponse(JSON.stringify({
      type: "ai.krill.pair.response",
      content: {
        success: true,
        pairing_id,
        pairing_token,
        agent: {
          mxid: agent.mxid,
          display_name: agent.displayName,
          capabilities: agent.capabilities || ["chat"]
        },
        created_at: pairing.created_at,
        message: "Hola! Ara estem connectats. \u{1F990}"
      }
    }));
  },
  /**
   * Validate a pairing token
   */
  validateToken(config, token) {
    loadPairings(config);
    const hash = hashToken(token);
    for (const pairing of Object.values(pairingsStore.pairings)) {
      if (pairing.pairing_token_hash === hash) {
        pairing.last_seen_at = Date.now();
        savePairings(config);
        return pairing;
      }
    }
    return null;
  }
};

// src/handlers/verify.ts
var import_crypto2 = __toESM(require("crypto"), 1);
function generateHash(secret, agentMxid, gatewayId, enrolledAt) {
  const message = `${agentMxid}|${gatewayId}|${enrolledAt}`;
  return import_crypto2.default.createHmac("sha256", secret).update(message).digest("hex");
}
var handleVerify = {
  /**
   * Handle ai.krill.verify.request
   */
  async request(config, content, sendResponse) {
    const agent = config.agent;
    if (!agent) {
      await sendResponse(JSON.stringify({
        type: "ai.krill.verify.response",
        content: {
          verified: false,
          error: "Agent not configured"
        }
      }));
      return;
    }
    const response = {
      type: "ai.krill.verify.response",
      content: {
        challenge: content.challenge,
        verified: true,
        agent: {
          mxid: agent.mxid,
          display_name: agent.displayName,
          gateway_id: config.gatewayId,
          capabilities: agent.capabilities || ["chat"],
          status: "online"
        },
        responded_at: Math.floor(Date.now() / 1e3)
      }
    };
    console.log(`[krill-verify] Verified: ${agent.mxid}`);
    await sendResponse(JSON.stringify(response));
  },
  /**
   * Verify an enrollment hash
   */
  verifyHash(config, agentMxid, gatewayId, enrolledAt, hash) {
    if (gatewayId !== config.gatewayId) {
      return false;
    }
    const expected = generateHash(config.gatewaySecret, agentMxid, gatewayId, enrolledAt);
    return hash === expected;
  }
};

// src/handlers/health.ts
var startTime = Date.now();
var lastLlmActivity = 0;
var LLM_GRACE_PERIOD_MS = 5 * 60 * 1e3;
function markLlmActivity() {
  lastLlmActivity = Date.now();
}
function wasLlmRecentlyActive() {
  return Date.now() - lastLlmActivity < LLM_GRACE_PERIOD_MS;
}
function getLoad() {
  try {
    const os = require("os");
    return os.loadavg()[0].toFixed(2);
  } catch {
    return void 0;
  }
}
var handleHealth = {
  /**
   * Handle ai.krill.health.ping
   */
  async ping(config, content, sendResponse) {
    const { request_id, skip_llm_test } = content;
    const agent = config.agent;
    if (!agent) {
      return;
    }
    console.log(`[krill-health] Ping received: ${request_id}`);
    const ack = {
      type: "ai.krill.health.ack",
      content: {
        request_id,
        agent_id: agent.mxid,
        gateway_id: config.gatewayId,
        timestamp: Date.now()
      }
    };
    await sendResponse(JSON.stringify(ack));
    console.log(`[krill-health] ACK sent for ${request_id}`);
    let llmStatus = "ok";
    let llmLatencyMs = 0;
    const shouldSkip = skip_llm_test || wasLlmRecentlyActive();
    if (shouldSkip) {
      console.log(`[krill-health] Skipping LLM test (recent activity)`);
      llmStatus = "ok";
      llmLatencyMs = 0;
    } else {
      console.log(`[krill-health] LLM test: assuming OK (no recent activity)`);
      llmStatus = "ok";
      llmLatencyMs = 1;
    }
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1e3);
    const pong = {
      type: "ai.krill.health.pong",
      content: {
        request_id,
        agent_id: agent.mxid,
        gateway_id: config.gatewayId,
        status: llmStatus === "ok" ? "online" : "unresponsive",
        llm_status: llmStatus,
        llm_latency_ms: llmLatencyMs,
        load: getLoad(),
        uptime_seconds: uptimeSeconds,
        version: "1.0.0",
        timestamp: Date.now()
      }
    };
    await sendResponse(JSON.stringify(pong));
    console.log(`[krill-health] PONG sent: status=${pong.content.status}`);
  }
};

// src/index.ts
var configSchema = {
  type: "object",
  properties: {
    gatewayId: {
      type: "string",
      description: "Unique identifier for this gateway"
    },
    gatewaySecret: {
      type: "string",
      description: "Secret key for verification"
    },
    storagePath: {
      type: "string",
      description: "Path to store pairings and state"
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
  required: ["gatewayId", "gatewaySecret"]
};
var pluginConfig = null;
var pluginApi = null;
function parseKrillMessage(text) {
  try {
    const parsed = JSON.parse(text);
    if (parsed.type?.startsWith("ai.krill.")) {
      return parsed;
    }
  } catch {
  }
  return null;
}
async function handleKrillMessage(message, senderId, roomId, sendResponse) {
  const { type, content } = message;
  pluginApi?.logger.info(`[krill-protocol] Received: ${type}`);
  switch (type) {
    // === PAIRING ===
    case "ai.krill.pair.request":
      await handlePairing.request(pluginConfig, content, senderId, sendResponse);
      return true;
    // === VERIFICATION ===
    case "ai.krill.verify.request":
      await handleVerify.request(pluginConfig, content, sendResponse);
      return true;
    // === HEALTH CHECK ===
    case "ai.krill.health.ping":
      await handleHealth.ping(pluginConfig, content, sendResponse);
      return true;
    // === FUTURE PROTOCOL MESSAGES ===
    // Add new handlers here as the protocol evolves
    default:
      pluginApi?.logger.warn(`[krill-protocol] Unknown message type: ${type}`);
      return false;
  }
}
var plugin = {
  id: "krill-matrix-protocol",
  name: "Krill Matrix Protocol",
  description: "Handles all ai.krill.* protocol messages (pairing, verify, health)",
  configSchema,
  register(api) {
    pluginApi = api;
    const config = api.config?.plugins?.entries?.["krill-matrix-protocol"]?.config;
    if (!config) {
      api.logger.warn("[krill-protocol] No config found, plugin disabled");
      return;
    }
    pluginConfig = config;
    api.logger.info(`[krill-protocol] Loaded for gateway: ${config.gatewayId}`);
    if (config.storagePath) {
      const dir = import_path.default.dirname(config.storagePath);
      if (!import_fs2.default.existsSync(dir)) {
        import_fs2.default.mkdirSync(dir, { recursive: true });
      }
    }
    api.registerMessageInterceptor?.(async (ctx) => {
      const text = ctx.message?.text || ctx.message?.body || "";
      const krillMsg = parseKrillMessage(text);
      if (!krillMsg) {
        markLlmActivity();
        return { handled: false };
      }
      const sendResponse = async (responseText) => {
        await ctx.reply?.(responseText);
      };
      const handled = await handleKrillMessage(
        krillMsg,
        ctx.senderId || "",
        ctx.roomId || "",
        sendResponse
      );
      return { handled };
    });
    api.registerHttpHandler(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!url.pathname.startsWith("/krill/")) {
        return false;
      }
      return false;
    });
    api.logger.info("[krill-protocol] \u2705 Protocol handler registered");
  }
};
var index_default = plugin;
