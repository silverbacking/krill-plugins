import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { execSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from "fs";
import { createHash } from "crypto";
import { pipeline } from "stream/promises";

interface UpdateConfig {
  apiUrl: string;
  updatesRoom: string;
  autoUpdate: boolean;
  checkIntervalMinutes: number;
}

interface PluginUpdate {
  plugin: string;
  version: string;
  changelog: string;
  checksum: string;
  download_url: string;
  required: boolean;
  min_gateway_version: string;
  published_at: string;
}

const DEFAULT_CONFIG: UpdateConfig = {
  apiUrl: "https://api.krillbot.app",
  updatesRoom: "#krill-updates:matrix.krillbot.app",
  autoUpdate: true,
  checkIntervalMinutes: 60,
};

let pluginConfig: UpdateConfig = DEFAULT_CONFIG;
let pluginApi: ClawdbotPluginApi | null = null;
let checkInterval: NodeJS.Timeout | null = null;

// Track installed plugin versions
const installedPlugins: Map<string, string> = new Map([
  ["krill-enrollment", "1.0.0"],
  ["krill-pairing", "1.0.0"],
  ["krill-update", "1.0.0"],
]);

/**
 * Verify file checksum
 */
function verifyChecksum(filePath: string, expectedChecksum: string): boolean {
  const [algo, hash] = expectedChecksum.split(":");
  if (algo !== "sha256") return false;

  const fileBuffer = require("fs").readFileSync(filePath);
  const actualHash = createHash("sha256").update(fileBuffer).digest("hex");
  return actualHash === hash;
}

/**
 * Download and install a plugin update
 */
async function installUpdate(update: PluginUpdate): Promise<boolean> {
  const logger = pluginApi?.logger;
  logger?.info(`[krill-update] Installing ${update.plugin} v${update.version}...`);

  try {
    // Create temp directory
    const tempDir = "/tmp/krill-updates";
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const tempFile = `${tempDir}/${update.plugin}-${update.version}.tgz`;

    // Download
    logger?.info(`[krill-update] Downloading from ${update.download_url}...`);
    const response = await fetch(update.download_url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
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
    
    // Notify that restart is needed
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

  try {
    const installed: Record<string, string> = {};
    for (const [name, version] of installedPlugins) {
      installed[name] = version;
    }

    const response = await fetch(`${pluginConfig.apiUrl}/v1/plugins/check-updates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installed }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const { updates, has_updates } = await response.json();

    if (!has_updates) {
      logger?.info(`[krill-update] All plugins up to date`);
      return;
    }

    logger?.info(`[krill-update] ${updates.length} update(s) available`);

    for (const update of updates) {
      logger?.info(`[krill-update] Available: ${update.plugin} ${update.current_version} → ${update.latest_version}`);
      
      if (pluginConfig.autoUpdate || update.required) {
        await installUpdate(update);
      }
    }
  } catch (error) {
    logger?.warn(`[krill-update] Check failed: ${error}`);
  }
}

/**
 * Handle Matrix update notification
 */
function handleUpdateNotification(event: any): void {
  const logger = pluginApi?.logger;
  const updateInfo = event.content?.["ai.krill.plugin.update"];

  if (!updateInfo) return;

  logger?.info(`[krill-update] 📦 Update notification: ${updateInfo.plugin} v${updateInfo.version}`);

  const currentVersion = installedPlugins.get(updateInfo.plugin);
  if (!currentVersion) {
    logger?.info(`[krill-update] Plugin ${updateInfo.plugin} not installed, skipping`);
    return;
  }

  if (currentVersion === updateInfo.version) {
    logger?.info(`[krill-update] Already at version ${updateInfo.version}`);
    return;
  }

  // Check if update should be applied
  if (pluginConfig.autoUpdate || updateInfo.required) {
    installUpdate(updateInfo as PluginUpdate);
  } else {
    logger?.info(`[krill-update] Auto-update disabled, skipping. Run manually if needed.`);
  }
}

const plugin = {
  id: "krill-update",
  name: "Krill Update",
  description: "Auto-update plugin for Krill Network gateways",

  register(api: ClawdbotPluginApi) {
    pluginApi = api;

    // Load config
    const config = api.config?.plugins?.entries?.["krill-update"]?.config as Partial<UpdateConfig> | undefined;
    pluginConfig = { ...DEFAULT_CONFIG, ...config };

    api.logger.info(`[krill-update] Plugin loaded`);
    api.logger.info(`[krill-update] API: ${pluginConfig.apiUrl}`);
    api.logger.info(`[krill-update] Auto-update: ${pluginConfig.autoUpdate}`);
    api.logger.info(`[krill-update] Check interval: ${pluginConfig.checkIntervalMinutes} minutes`);

    // Register Matrix event handler for update notifications
    // This requires Clawdbot to expose matrix event handling to plugins
    // For now, we rely on periodic polling

    // Start periodic check
    if (pluginConfig.checkIntervalMinutes > 0) {
      checkInterval = setInterval(
        checkForUpdates,
        pluginConfig.checkIntervalMinutes * 60 * 1000
      );

      // Initial check after 30 seconds
      setTimeout(checkForUpdates, 30000);
    }

    // Register CLI commands
    api.registerCli?.(({ program }) => {
      const update = program.command("krill-update").description("Krill plugin update commands");

      update.command("check").description("Check for plugin updates").action(async () => {
        await checkForUpdates();
      });

      update.command("list").description("List installed plugins").action(() => {
        console.log("\nInstalled Krill plugins:");
        for (const [name, version] of installedPlugins) {
          console.log(`  ${name}: v${version}`);
        }
      });

      update.command("status").description("Show update plugin status").action(() => {
        console.log(`\n🔄 Krill Update Plugin Status`);
        console.log(`   API: ${pluginConfig.apiUrl}`);
        console.log(`   Auto-update: ${pluginConfig.autoUpdate}`);
        console.log(`   Check interval: ${pluginConfig.checkIntervalMinutes} min`);
        console.log(`   Installed plugins: ${installedPlugins.size}`);
      });
    }, { commands: ["krill-update"] });
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
