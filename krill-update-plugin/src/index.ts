import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { execSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync, unlinkSync, readFileSync } from "fs";
import { createHash, createHmac } from "crypto";
import { pipeline } from "stream/promises";

interface UpdateConfig {
  apiUrl: string;
  updatesRoom: string;
  autoUpdate: boolean;
  checkIntervalMinutes: number;
  matrixHomeserver: string;
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
  updatesRoom: "!XEo07d0FSUQ7pUhNuteBMl4iRXsZy_PjKwBf7SdBAtk",  // #krill-updates room ID
  autoUpdate: true,
  checkIntervalMinutes: 60,
  matrixHomeserver: "https://matrix.krillbot.app",
};

let pluginConfig: UpdateConfig = DEFAULT_CONFIG;
let pluginApi: ClawdbotPluginApi | null = null;
let checkInterval: NodeJS.Timeout | null = null;
let matrixSyncInterval: NodeJS.Timeout | null = null;
let lastSyncToken: string | null = null;

// Track installed plugin versions
const installedPlugins: Map<string, string> = new Map([
  ["krill-enrollment", "0.1.0"],
  ["krill-update", "1.0.0"],
  ["krill-matrix", "0.1.0"],
]);

// Get gateway config for auth
function getGatewayAuth(plugin: string, version: string): string | null {
  const enrollConfig = (pluginApi as any)?.config?.plugins?.entries?.["krill-enrollment"]?.config;
  if (!enrollConfig?.gatewayId || !enrollConfig?.gatewaySecret) {
    return null;
  }
  
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${enrollConfig.gatewayId}:${timestamp}:${plugin}:${version}`;
  const signature = createHmac("sha256", enrollConfig.gatewaySecret)
    .update(message)
    .digest("hex")
    .substring(0, 32);
  
  return `${enrollConfig.gatewayId}:${timestamp}:${signature}`;
}

// Get Matrix access token from enrollment config
function getMatrixToken(): string | null {
  const enrollConfig = (pluginApi as any)?.config?.plugins?.entries?.["krill-enrollment"]?.config;
  return enrollConfig?.matrixAccessToken || null;
}

/**
 * Verify file checksum
 */
function verifyChecksum(filePath: string, expectedChecksum: string): boolean {
  const [algo, hash] = expectedChecksum.split(":");
  if (algo !== "sha256") return false;

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
    const authHeader = getGatewayAuth(update.plugin, update.version);
    if (!authHeader) {
      throw new Error("Cannot generate auth - missing gateway config");
    }

    // Download with authentication
    logger?.info(`[krill-update] Downloading from ${update.download_url}...`);
    const response = await fetch(update.download_url, {
      headers: { "X-Krill-Auth": authHeader }
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
 * Check for updates via API (fallback/periodic)
 */
async function checkForUpdates(): Promise<void> {
  const logger = pluginApi?.logger;
  logger?.info(`[krill-update] Checking for updates via API...`);

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
      logger?.info(`[krill-update] Available: ${update.plugin} ${update.current} → ${update.latest}`);
      
      if (pluginConfig.autoUpdate || update.required) {
        await installUpdate({
          plugin: update.plugin,
          version: update.latest,
          download_url: update.download_url,
          checksum: update.checksum,
          required: update.required,
        } as PluginUpdate);
      }
    }
  } catch (error) {
    logger?.warn(`[krill-update] Check failed: ${error}`);
  }
}

/**
 * Join the updates room
 */
async function joinUpdatesRoom(): Promise<boolean> {
  const logger = pluginApi?.logger;
  const token = getMatrixToken();
  
  if (!token) {
    logger?.warn(`[krill-update] No Matrix token available, cannot join updates room`);
    return false;
  }

  try {
    const response = await fetch(
      `${pluginConfig.matrixHomeserver}/_matrix/client/v3/join/${encodeURIComponent(pluginConfig.updatesRoom)}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      }
    );

    if (response.ok || response.status === 403) {
      // 403 might mean already joined
      logger?.info(`[krill-update] ✅ Joined #krill-updates room`);
      return true;
    }
    
    logger?.warn(`[krill-update] Failed to join updates room: ${response.status}`);
    return false;
  } catch (error) {
    logger?.warn(`[krill-update] Error joining room: ${error}`);
    return false;
  }
}

/**
 * Sync Matrix events and process updates
 */
async function syncMatrixUpdates(): Promise<void> {
  const logger = pluginApi?.logger;
  const token = getMatrixToken();
  
  if (!token) return;

  try {
    const params = new URLSearchParams({
      timeout: "0",  // immediate return for polling
      filter: JSON.stringify({
        room: {
          rooms: [pluginConfig.updatesRoom],
          timeline: { limit: 10 },
        },
      }),
    });
    
    if (lastSyncToken) {
      params.set("since", lastSyncToken);
    }

    const response = await fetch(
      `${pluginConfig.matrixHomeserver}/_matrix/client/v3/sync?${params}`,
      {
        headers: { "Authorization": `Bearer ${token}` },
      }
    );

    if (!response.ok) {
      throw new Error(`Sync failed: ${response.status}`);
    }

    const data = await response.json();
    lastSyncToken = data.next_batch;

    // Process events from updates room
    const roomData = data.rooms?.join?.[pluginConfig.updatesRoom];
    if (roomData?.timeline?.events) {
      for (const event of roomData.timeline.events) {
        const updateInfo = event.content?.["ai.krill.plugin.update"];
        if (updateInfo && event.type === "m.room.message") {
          logger?.info(`[krill-update] 🔔 Real-time update notification: ${updateInfo.plugin} v${updateInfo.version}`);
          
          const currentVersion = installedPlugins.get(updateInfo.plugin);
          if (currentVersion && currentVersion !== updateInfo.version) {
            if (pluginConfig.autoUpdate || updateInfo.required) {
              await installUpdate(updateInfo as PluginUpdate);
            } else {
              logger?.info(`[krill-update] Update available but auto-update disabled`);
            }
          }
        }
      }
    }
  } catch (error) {
    // Silent fail for sync errors - will retry
  }
}

const plugin = {
  id: "krill-update",
  name: "Krill Update",
  description: "Auto-update plugin for Krill Network gateways with real-time Matrix notifications",

  async register(api: ClawdbotPluginApi) {
    pluginApi = api;

    // Load config
    const config = api.config?.plugins?.entries?.["krill-update"]?.config as Partial<UpdateConfig> | undefined;
    pluginConfig = { ...DEFAULT_CONFIG, ...config };

    api.logger.info(`[krill-update] Plugin loaded`);
    api.logger.info(`[krill-update] API: ${pluginConfig.apiUrl}`);
    api.logger.info(`[krill-update] Auto-update: ${pluginConfig.autoUpdate}`);
    api.logger.info(`[krill-update] Real-time Matrix sync: enabled`);

    // Join updates room
    setTimeout(async () => {
      const joined = await joinUpdatesRoom();
      if (joined) {
        // Start Matrix sync for real-time updates (every 30 seconds)
        matrixSyncInterval = setInterval(syncMatrixUpdates, 30000);
        // Initial sync
        await syncMatrixUpdates();
      }
    }, 5000);

    // Start periodic check as fallback (every 60 min)
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
        console.log(`   Matrix sync: ${matrixSyncInterval ? "active" : "inactive"}`);
        console.log(`   Installed plugins: ${installedPlugins.size}`);
      });

      update.command("sync").description("Force Matrix sync now").action(async () => {
        console.log("Syncing Matrix updates...");
        await syncMatrixUpdates();
        console.log("Done");
      });
    }, { commands: ["krill-update"] });
  },

  unload() {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    if (matrixSyncInterval) {
      clearInterval(matrixSyncInterval);
      matrixSyncInterval = null;
    }
    pluginApi?.logger.info(`[krill-update] Plugin unloaded`);
  },
};

export default plugin;
