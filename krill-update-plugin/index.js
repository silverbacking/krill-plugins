var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var import_child_process = require("child_process");
var import_fs = require("fs");
var import_crypto = require("crypto");
var import_promises = require("stream/promises");
var DEFAULT_CONFIG = {
  apiUrl: "https://api.krillbot.network",
  autoUpdate: true,
  checkIntervalMinutes: 60
};
var pluginConfig = DEFAULT_CONFIG;
var pluginApi = null;
var checkInterval = null;
var installedPlugins = /* @__PURE__ */ new Map([
  ["krill-agent-init", "1.0.0"],
  ["krill-matrix-protocol", "1.0.0"],
  ["krill-update", "1.0.0"]
]);
function getGatewayCredentials() {
  const initConfig = pluginApi?.config?.plugins?.entries?.["krill-agent-init"]?.config;
  if (!initConfig?.gatewayId || !initConfig?.gatewaySecret) {
    return null;
  }
  return {
    gatewayId: initConfig.gatewayId,
    gatewaySecret: initConfig.gatewaySecret
  };
}
function generateAuthHeader(plugin2, version) {
  const creds = getGatewayCredentials();
  if (!creds) return null;
  const timestamp = Math.floor(Date.now() / 1e3);
  const message = `${creds.gatewayId}:${timestamp}:${plugin2}:${version}`;
  const signature = (0, import_crypto.createHmac)("sha256", creds.gatewaySecret).update(message).digest("hex").substring(0, 32);
  return `${creds.gatewayId}:${timestamp}:${signature}`;
}
function verifyChecksum(filePath, expectedChecksum) {
  const parts = expectedChecksum.split(":");
  const algo = parts.length === 2 ? parts[0] : "sha256";
  const hash = parts.length === 2 ? parts[1] : parts[0];
  if (algo !== "sha256") {
    pluginApi?.logger.warn(`[krill-update] Unsupported checksum algorithm: ${algo}`);
    return false;
  }
  const fileBuffer = (0, import_fs.readFileSync)(filePath);
  const actualHash = (0, import_crypto.createHash)("sha256").update(fileBuffer).digest("hex");
  return actualHash === hash;
}
async function installUpdate(update) {
  const logger = pluginApi?.logger;
  logger?.info(`[krill-update] \u{1F4E6} Installing ${update.plugin} v${update.version}...`);
  try {
    const tempDir = "/tmp/krill-updates";
    if (!(0, import_fs.existsSync)(tempDir)) {
      (0, import_fs.mkdirSync)(tempDir, { recursive: true });
    }
    const tempFile = `${tempDir}/${update.plugin}-${update.version}.tgz`;
    const authHeader = generateAuthHeader(update.plugin, update.version);
    if (!authHeader) {
      throw new Error("Cannot generate auth - krill-agent-init not configured");
    }
    logger?.info(`[krill-update] Downloading from ${update.download_url}...`);
    const response = await fetch(update.download_url, {
      headers: { "X-Krill-Auth": authHeader }
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Download failed: ${response.status} - ${error}`);
    }
    const fileStream = (0, import_fs.createWriteStream)(tempFile);
    await (0, import_promises.pipeline)(response.body, fileStream);
    logger?.info(`[krill-update] Verifying checksum...`);
    if (!verifyChecksum(tempFile, update.checksum)) {
      (0, import_fs.unlinkSync)(tempFile);
      throw new Error("Checksum verification failed!");
    }
    logger?.info(`[krill-update] Installing via npm...`);
    (0, import_child_process.execSync)(`npm install -g ${tempFile}`, { stdio: "pipe" });
    (0, import_fs.unlinkSync)(tempFile);
    installedPlugins.set(update.plugin, update.version);
    logger?.info(`[krill-update] \u2705 ${update.plugin} v${update.version} installed!`);
    logger?.warn(`[krill-update] \u26A0\uFE0F Gateway restart required to load new plugin version`);
    return true;
  } catch (error) {
    logger?.warn(`[krill-update] Installation failed: ${error}`);
    return false;
  }
}
async function checkForUpdates() {
  const logger = pluginApi?.logger;
  logger?.info(`[krill-update] Checking for updates...`);
  const creds = getGatewayCredentials();
  if (!creds) {
    logger?.warn(`[krill-update] Cannot check updates - krill-agent-init not configured`);
    return;
  }
  try {
    const installed = {};
    for (const [name, version] of installedPlugins) {
      installed[name] = version;
    }
    const timestamp = Math.floor(Date.now() / 1e3);
    const message = `${creds.gatewayId}:${timestamp}:check`;
    const signature = (0, import_crypto.createHmac)("sha256", creds.gatewaySecret).update(message).digest("hex").substring(0, 32);
    const response = await fetch(`${pluginConfig.apiUrl}/v1/plugins/check-updates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Krill-Auth": `${creds.gatewayId}:${timestamp}:${signature}`
      },
      body: JSON.stringify({
        gateway_id: creds.gatewayId,
        installed
      })
    });
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    const data = await response.json();
    const { updates, has_updates } = data;
    if (!has_updates) {
      logger?.info(`[krill-update] \u2705 All plugins up to date`);
      return;
    }
    logger?.info(`[krill-update] \u{1F514} ${updates.length} update(s) available`);
    for (const update of updates) {
      logger?.info(
        `[krill-update] Available: ${update.plugin} ${update.current} \u2192 ${update.latest}`
      );
      if (pluginConfig.autoUpdate || update.required) {
        await installUpdate({
          plugin: update.plugin,
          version: update.latest,
          download_url: update.download_url,
          checksum: update.checksum,
          required: update.required
        });
      } else {
        logger?.info(`[krill-update] Skipping (auto-update disabled)`);
      }
    }
  } catch (error) {
    logger?.warn(`[krill-update] Check failed: ${error}`);
  }
}
var plugin = {
  id: "krill-update",
  name: "Krill Update",
  description: "Auto-update plugin for Krill Network gateways (API polling)",
  configSchema: {
    type: "object",
    properties: {
      apiUrl: {
        type: "string",
        description: "Krill API URL for update checks",
        default: "https://api.krillbot.network"
      },
      autoUpdate: {
        type: "boolean",
        description: "Automatically install updates",
        default: true
      },
      checkIntervalMinutes: {
        type: "number",
        description: "Minutes between update checks (0 to disable)",
        default: 60
      }
    }
  },
  async register(api) {
    pluginApi = api;
    const config = api.config?.plugins?.entries?.["krill-update"]?.config;
    pluginConfig = { ...DEFAULT_CONFIG, ...config };
    api.logger.info(`[krill-update] \u2705 Plugin loaded`);
    api.logger.info(`[krill-update] API: ${pluginConfig.apiUrl}`);
    api.logger.info(`[krill-update] Auto-update: ${pluginConfig.autoUpdate}`);
    api.logger.info(`[krill-update] Check interval: ${pluginConfig.checkIntervalMinutes} min`);
    if (pluginConfig.checkIntervalMinutes > 0) {
      checkInterval = setInterval(
        checkForUpdates,
        pluginConfig.checkIntervalMinutes * 60 * 1e3
      );
      setTimeout(checkForUpdates, 6e4);
    }
    api.registerCli?.(
      ({ program }) => {
        const update = program.command("krill-update").description("Krill plugin update commands");
        update.command("check").description("Check for plugin updates now").action(async () => {
          await checkForUpdates();
        });
        update.command("list").description("List installed Krill plugins").action(() => {
          console.log("\n\u{1F990} Installed Krill plugins:");
          for (const [name, version] of installedPlugins) {
            console.log(`   ${name}: v${version}`);
          }
          console.log("");
        });
        update.command("status").description("Show update plugin status").action(() => {
          console.log(`
\u{1F504} Krill Update Plugin Status`);
          console.log(`   API: ${pluginConfig.apiUrl}`);
          console.log(`   Auto-update: ${pluginConfig.autoUpdate}`);
          console.log(`   Check interval: ${pluginConfig.checkIntervalMinutes} min`);
          console.log(`   Next check: ${checkInterval ? "scheduled" : "disabled"}`);
          console.log(`   Installed plugins: ${installedPlugins.size}`);
          console.log("");
        });
      },
      { commands: ["krill-update"] }
    );
  },
  unload() {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    pluginApi?.logger.info(`[krill-update] Plugin unloaded`);
  }
};
var index_default = plugin;
