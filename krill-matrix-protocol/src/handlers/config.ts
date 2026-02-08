/**
 * Config Update Handler
 * 
 * Handles ai.krill.config.update messages from the Krill API.
 * Applies config patches to openclaw.json with backup and rollback.
 */

import { execSync, spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface ConfigUpdateContent {
  request_id?: string;
  gateway_id?: string;
  config_patch: Record<string, any>;
  restart?: boolean;
  requested_by?: string;
  timestamp?: number;
}

export interface ConfigHandlerOptions {
  configPath?: string;
  allowedConfigSenders: string[];
  restartCommand?: string;
  healthCheckTimeoutSeconds?: number;
  sendResponse: (roomId: string, content: any) => Promise<void>;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error?: (msg: string) => void;
  };
}

let options: ConfigHandlerOptions | null = null;

export function initConfigHandler(opts: ConfigHandlerOptions): void {
  options = opts;
}

/**
 * Deep merge two objects
 */
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Backup current config
 */
function backupConfig(configPath: string): string {
  const backupPath = configPath + ".bak." + Date.now();
  if (existsSync(configPath)) {
    copyFileSync(configPath, backupPath);
  }
  return backupPath;
}

/**
 * Restore config from backup
 */
function restoreConfig(configPath: string, backupPath: string): void {
  if (existsSync(backupPath)) {
    copyFileSync(backupPath, configPath);
    unlinkSync(backupPath);
  }
}

/**
 * Apply config patch
 */
function applyConfigPatch(configPath: string, patch: Record<string, any>): boolean {
  try {
    let config: Record<string, any> = {};
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8");
      config = JSON.parse(content);
    }
    
    const merged = deepMerge(config, patch);
    writeFileSync(configPath, JSON.stringify(merged, null, 2));
    return true;
  } catch (error) {
    options?.logger.warn(`Failed to apply config patch: ${error}`);
    return false;
  }
}

/**
 * Restart the gateway
 */
function restartGateway(restartCommand?: string): boolean {
  try {
    const cmd = restartCommand || "systemctl restart openclaw-gateway";
    execSync(cmd, { timeout: 30000 });
    return true;
  } catch (error) {
    options?.logger.warn(`Restart command failed: ${error}`);
    return false;
  }
}

/**
 * Check gateway health
 */
async function checkGatewayHealth(timeoutSeconds: number = 30): Promise<boolean> {
  const start = Date.now();
  const maxWait = timeoutSeconds * 1000;
  
  while (Date.now() - start < maxWait) {
    try {
      const response = await fetch("http://localhost:18789/api/status");
      if (response.ok) {
        return true;
      }
    } catch {
      // Gateway not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return false;
}

/**
 * Send config update result
 */
async function sendConfigUpdateResult(
  roomId: string,
  requestId: string,
  success: boolean,
  message: string
): Promise<void> {
  const response = {
    type: "ai.krill.config.update.result",
    content: {
      request_id: requestId,
      success,
      message,
      timestamp: Math.floor(Date.now() / 1000),
    },
  };

  await options?.sendResponse(roomId, response);
}

/**
 * Handle ai.krill.config.update message
 */
export async function handleConfig(
  event: { sender: string; room_id: string; event_id: string; content: ConfigUpdateContent }
): Promise<boolean> {
  if (!options) {
    console.error("[config] Handler not initialized!");
    return false;
  }

  const { logger } = options;
  const content = event.content;
  const requestId = content.request_id || event.event_id;

  logger.info(`[config] 📨 Received config update request from ${event.sender}`);

  // Security check: verify sender is allowed
  if (options.allowedConfigSenders.length > 0) {
    if (!options.allowedConfigSenders.includes(event.sender)) {
      logger.warn(`[config] ⛔ Sender ${event.sender} not in allowed list`);
      await sendConfigUpdateResult(event.room_id, requestId, false, "Sender not authorized");
      return true;
    }
  }

  // Validate content
  if (!content.config_patch || typeof content.config_patch !== "object") {
    logger.warn(`[config] Invalid config_patch in message`);
    await sendConfigUpdateResult(event.room_id, requestId, false, "Invalid config_patch");
    return true;
  }

  const configPath = options.configPath || join(homedir(), ".openclaw", "openclaw.json");
  const backupPath = backupConfig(configPath);

  // Apply the patch
  const patchApplied = applyConfigPatch(configPath, content.config_patch);
  if (!patchApplied) {
    await sendConfigUpdateResult(event.room_id, requestId, false, "Failed to apply config patch");
    return true;
  }

  // Restart if requested
  if (content.restart !== false) {
    const restarted = restartGateway(options.restartCommand);
    if (!restarted) {
      restoreConfig(configPath, backupPath);
      await sendConfigUpdateResult(event.room_id, requestId, false, "Restart command failed, config restored");
      return true;
    }

    // Wait and check health
    const isHealthy = await checkGatewayHealth(options.healthCheckTimeoutSeconds || 30);
    if (!isHealthy) {
      logger.warn(`[config] 🚨 Gateway unhealthy! Rolling back config...`);
      restoreConfig(configPath, backupPath);
      restartGateway(options.restartCommand);

      const recovered = await checkGatewayHealth(options.healthCheckTimeoutSeconds || 30);
      if (recovered) {
        await sendConfigUpdateResult(
          event.room_id,
          requestId,
          false,
          "Gateway failed to start with new config. Rolled back successfully."
        );
      } else {
        await sendConfigUpdateResult(
          event.room_id,
          requestId,
          false,
          "CRITICAL: Gateway failed and rollback may have failed. Manual intervention required!"
        );
      }
      return true;
    }
  }

  // Success!
  logger.info(`[config] ✅ Config update successful!`);
  await sendConfigUpdateResult(event.room_id, requestId, true, "Config updated successfully");
  return true;
}
