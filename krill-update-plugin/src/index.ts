/**
 * Krill Update Plugin
 * 
 * Auto-update system for Krill Network gateways.
 * Uses API polling only (scalable for high volume of agents).
 * 
 * Depends on: krill-agent-init (for gatewayId/gatewaySecret)
 */

// Type definition for Clawdbot Plugin API
interface ClawdbotPluginApi {
  config?: any;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error?: (msg: string) => void;
  };
  registerCli?: (fn: (ctx: { program: any }) => void, opts?: { commands: string[] }) => void;
}
import { execSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync, unlinkSync, readFileSync } from "fs";
import { createHash, createHmac } from "crypto";
import { pipeline } from "stream/promises";

interface UpdateConfig {
  apiUrl: string;
  autoUpdate: boolean;
  checkIntervalMinutes: number;
}

interface PluginUpdate {
  plugin: string;
  version: string;
  changelog?: string;
  checksum: string;
  download_url: string;
  required: boolean;
  min_gateway_version?: string;
  published_at?: string;
}

const DEFAULT_CONFIG: UpdateConfig = {
  apiUrl: "https://api.krillbot.network",
  autoUpdate: true,
  checkIntervalMinutes: 60,
};

let pluginConfig: UpdateConfig = DEFAULT_CONFIG;
let pluginApi: ClawdbotPluginApi | null = null;
let checkInterval: NodeJS.Timeout | null = null;

// Track installed plugin versions
const installedPlugins: Map<string, string> = new Map([
  ["krill-agent-init", "1.0.0"],
  ["krill-matrix-protocol", "1.0.0"],
  ["krill-update", "1.0.0"],
]);

/**
 * Get gateway credentials from krill-agent-init config
 */
function getGatewayCredentials(): { gatewayId: string; gatewaySecret: string } | null {
  const initConfig = (pluginApi as any)?.config?.plugins?.entries?.["krill-agent-init"]?.config;
  if (!initConfig?.gatewayId || !initConfig?.gatewaySecret) {
    return null;
  }
  return {
    gatewayId: initConfig.gatewayId,
    gatewaySecret: initConfig.gatewaySecret,
  };
}

/**
 * Generate auth header for API requests
 */
function generateAuthHeader(plugin: string, version: string): string | null {
  const creds = getGatewayCredentials();
  if (!creds) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${creds.gatewayId}:${timestamp}:${plugin}:${version}`;
  const signature = createHmac("sha256", creds.gatewaySecret)
    .update(message)
    .digest("hex")
    .substring(0, 32);

  return `${creds.gatewayId}:${timestamp}:${signature}`;
}

/**
 * Verify file checksum
 */
function verifyChecksum(filePath: string, expectedChecksum: string): boolean {
  const parts = expectedChecksum.split(":");
  const algo = parts.length === 2 ? parts[0] : "sha256";
  const hash = parts.length === 2 ? parts[1] : parts[0];
  
  if (algo !== "sha256") {
    pluginApi?.logger.warn(`[krill-update] Unsupported checksum algorithm: ${algo}`);
    return false;
  }

  const fileBuffer = readFileSync(filePath);
  const actualHash = createHash("sha256").update(fileBuffer).digest("hex");
  return actualHash === hash;
}

/**
 * Download and install a plugin update
 */
async function installUpdate(update: PluginUpdate): Promise<boolean> {
  const logger = pluginApi?.logger;
  logger?.info(`[krill-update] 📦 Installing ${update.plugin} v${update.version}...`);

  try {
    const tempDir = "/tmp/krill-updates";
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const tempFile = `${tempDir}/${update.plugin}-${update.version}.tgz`;

    // Generate auth header
    const authHeader = generateAuthHeader(update.plugin, update.version);
    if (!authHeader) {
      throw new Error("Cannot generate auth - krill-agent-init not configured");
    }

    // Download with authentication
    logger?.info(`[krill-update] Downloading from ${update.download_url}...`);
    const response = await fetch(update.download_url, {
      headers: { "X-Krill-Auth": authHeader },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Download failed: ${response.status} - ${error}`);
    }

    const fileStream = createWriteStream(tempFile);
    await pipeline(response.body as any, fileStream);

    // Verify checksum
    logger?.info(`[krill-update] Verifying checksum...`);
    if (!verifyChecksum(tempFile, update.checksum)) {
      unlinkSync(tempFile);
      throw new Error("Checksum verification failed!");
    }

    // Install via npm
    logger?.info(`[krill-update] Installing via npm...`);
    execSync(`npm install -g ${tempFile}`, { stdio: "pipe" });

    // Cleanup
    unlinkSync(tempFile);

    // Update tracked version
    installedPlugins.set(update.plugin, update.version);

    logger?.info(`[krill-update] ✅ ${update.plugin} v${update.version} installed!`);
    logger?.warn(`[krill-update] ⚠️ Gateway restart required to load new plugin version`);

    return true;
  } catch (error) {
    logger?.warn(`[krill-update] Installation failed: ${error}`);
    return false;
  }
}

/**
 * Check for updates via API
 */
async function checkForUpdates(): Promise<void> {
  const logger = pluginApi?.logger;
  logger?.info(`[krill-update] Checking for updates...`);

  const creds = getGatewayCredentials();
  if (!creds) {
    logger?.warn(`[krill-update] Cannot check updates - krill-agent-init not configured`);
    return;
  }

  try {
    const installed: Record<string, string> = {};
    for (const [name, version] of installedPlugins) {
      installed[name] = version;
    }

    // Generate auth for check request
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `${creds.gatewayId}:${timestamp}:check`;
    const signature = createHmac("sha256", creds.gatewaySecret)
      .update(message)
      .digest("hex")
      .substring(0, 32);

    const response = await fetch(`${pluginConfig.apiUrl}/v1/plugins/check-updates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Krill-Auth": `${creds.gatewayId}:${timestamp}:${signature}`,
      },
      body: JSON.stringify({
        gateway_id: creds.gatewayId,
        installed,
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const { updates, has_updates } = data;

    if (!has_updates) {
      logger?.info(`[krill-update] ✅ All plugins up to date`);
      return;
    }

    logger?.info(`[krill-update] 🔔 ${updates.length} update(s) available`);

    for (const update of updates) {
      logger?.info(
        `[krill-update] Available: ${update.plugin} ${update.current} → ${update.latest}`
      );

      if (pluginConfig.autoUpdate || update.required) {
        await installUpdate({
          plugin: update.plugin,
          version: update.latest,
          download_url: update.download_url,
          checksum: update.checksum,
          required: update.required,
        } as PluginUpdate);
      } else {
        logger?.info(`[krill-update] Skipping (auto-update disabled)`);
      }
    }
  } catch (error) {
    logger?.warn(`[krill-update] Check failed: ${error}`);
  }
}

const plugin = {
  id: "krill-update",
  name: "Krill Update",
  description: "Auto-update plugin for Krill Network gateways (API polling)",

  configSchema: {
    type: "object",
    properties: {
      apiUrl: {
        type: "string",
        description: "Krill API URL for update checks",
        default: "https://api.krillbot.network",
      },
      autoUpdate: {
        type: "boolean",
        description: "Automatically install updates",
        default: true,
      },
      checkIntervalMinutes: {
        type: "number",
        description: "Minutes between update checks (0 to disable)",
        default: 60,
      },
    },
  },

  async register(api: ClawdbotPluginApi) {
    pluginApi = api;

    // Load config
    const config = api.config?.plugins?.entries?.["krill-update"]?.config as
      | Partial<UpdateConfig>
      | undefined;
    pluginConfig = { ...DEFAULT_CONFIG, ...config };

    api.logger.info(`[krill-update] ✅ Plugin loaded`);
    api.logger.info(`[krill-update] API: ${pluginConfig.apiUrl}`);
    api.logger.info(`[krill-update] Auto-update: ${pluginConfig.autoUpdate}`);
    api.logger.info(`[krill-update] Check interval: ${pluginConfig.checkIntervalMinutes} min`);

    // Start periodic check
    if (pluginConfig.checkIntervalMinutes > 0) {
      checkInterval = setInterval(
        checkForUpdates,
        pluginConfig.checkIntervalMinutes * 60 * 1000
      );
      // Initial check after 60 seconds (give time for other plugins to load)
      setTimeout(checkForUpdates, 60000);
    }

    // Register CLI commands
    api.registerCli?.(
      ({ program }) => {
        const update = program
          .command("krill-update")
          .description("Krill plugin update commands");

        update
          .command("check")
          .description("Check for plugin updates now")
          .action(async () => {
            await checkForUpdates();
          });

        update
          .command("list")
          .description("List installed Krill plugins")
          .action(() => {
            console.log("\n🦐 Installed Krill plugins:");
            for (const [name, version] of installedPlugins) {
              console.log(`   ${name}: v${version}`);
            }
            console.log("");
          });

        update
          .command("status")
          .description("Show update plugin status")
          .action(() => {
            console.log(`\n🔄 Krill Update Plugin Status`);
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
  },
};

export default plugin;
