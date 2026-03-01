/**
 * Camera Sense Handler
 * 
 * Processes ai.krill.sense.camera messages:
 * 1. Downloads the image from mxc:// URL
 * 2. Saves to disk in captures/ folder
 * 3. Updates latest.jpg and motion_log.json
 * 4. Does NOT forward to LLM — agent uses krill-camera skill to access
 * 
 * File structure:
 *   <storagePath>/camera/
 *     latest.jpg            ← most recent capture
 *     motion_log.json       ← log of motion events [{timestamp, score, facing, file}]
 *     captures/
 *       2026-03-01_132000.jpg
 *       2026-03-01_132005.jpg
 */

import fs from "fs";
import path from "path";
import type { SenseContext } from "./types.js";

const MAX_LOG_ENTRIES = 1000;
const MAX_CAPTURES = 500; // Keep last 500 images, prune older

interface MotionLogEntry {
  timestamp: string;
  motionScore: number;
  facing: string;
  sensitivity: string;
  file: string;
}

/**
 * Download an mxc:// URL via the Matrix client-server media API.
 * Requires the MatrixClient to be available in the context for auth.
 */
async function downloadMxc(
  mxcUrl: string, 
  homeserverUrl: string,
  accessToken: string,
  logger: any
): Promise<Buffer | null> {
  try {
    // Parse mxc://server/mediaId
    const mxcUri = new URL(mxcUrl);
    const serverName = mxcUri.hostname || mxcUri.host;
    const mediaId = mxcUri.pathname.replace(/^\//, "");
    
    // Use authenticated media endpoint (Matrix 1.11+)
    const downloadUrl = `${homeserverUrl}/_matrix/client/v1/media/download/${serverName}/${mediaId}`;
    
    const resp = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30000),
    });
    
    if (!resp.ok) {
      logger.warn(`[camera] Failed to download ${mxcUrl}: ${resp.status} ${resp.statusText}`);
      return null;
    }
    
    const arrayBuffer = await resp.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (e: any) {
    logger.error(`[camera] Download error for ${mxcUrl}: ${e.message}`);
    return null;
  }
}

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch { /* ignore */ }
  return fallback;
}

function writeJson(filePath: string, data: any) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Prune old captures if we exceed MAX_CAPTURES.
 * Deletes oldest files first.
 */
function pruneCaptures(capturesDir: string, logger: any) {
  try {
    if (!fs.existsSync(capturesDir)) return;
    const files = fs.readdirSync(capturesDir)
      .filter(f => f.endsWith(".jpg"))
      .sort(); // Sorted by name = sorted by timestamp
    
    if (files.length > MAX_CAPTURES) {
      const toDelete = files.slice(0, files.length - MAX_CAPTURES);
      for (const f of toDelete) {
        fs.unlinkSync(path.join(capturesDir, f));
      }
      logger.info(`[camera] Pruned ${toDelete.length} old captures`);
    }
  } catch (e: any) {
    logger.warn(`[camera] Prune error: ${e.message}`);
  }
}

export async function handleCamera(ctx: SenseContext): Promise<void> {
  const senseData = ctx.content?.["ai.krill.sense"];
  if (!senseData) {
    ctx.logger.warn("[camera] Missing ai.krill.sense data");
    return;
  }

  const mxcUrl = senseData.mxc_url;
  if (!mxcUrl) {
    ctx.logger.warn("[camera] Missing mxc_url in sense data");
    return;
  }

  const timestamp = senseData.timestamp || new Date().toISOString();
  const motionScore = senseData.motion_score ?? 0;
  const facing = senseData.facing || "back";
  const sensitivity = senseData.sensitivity || "medium";
  const subtype = senseData.subtype || "motion";

  // Setup directories
  const cameraDir = path.join(ctx.config.storagePath, "camera");
  const capturesDir = path.join(cameraDir, "captures");
  ensureDir(capturesDir);

  // Get homeserver URL and access token from config (passed from MatrixClient)
  const homeserverUrl = ctx.config.homeserverUrl;
  const accessToken = ctx.config.accessToken;

  if (!homeserverUrl || !accessToken) {
    ctx.logger.error("[camera] No homeserver URL or access token available for media download");
    return;
  }

  // Download the image
  ctx.logger.info(`[camera] Downloading motion capture (score: ${(motionScore * 100).toFixed(1)}%, facing: ${facing})`);
  const imageData = await downloadMxc(mxcUrl, homeserverUrl, accessToken, ctx.logger);
  
  if (!imageData || imageData.length < 1000) {
    ctx.logger.warn(`[camera] Download failed or image too small (${imageData?.length ?? 0} bytes)`);
    return;
  }

  // Generate filename from timestamp
  const ts = new Date(timestamp);
  const fileName = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}-${String(ts.getDate()).padStart(2, "0")}_${String(ts.getHours()).padStart(2, "0")}${String(ts.getMinutes()).padStart(2, "0")}${String(ts.getSeconds()).padStart(2, "0")}.jpg`;
  
  // Save capture
  const capturePath = path.join(capturesDir, fileName);
  fs.writeFileSync(capturePath, imageData);
  ctx.logger.info(`[camera] Saved capture: ${fileName} (${(imageData.length / 1024).toFixed(1)} KB)`);

  // Update latest.jpg
  const latestPath = path.join(cameraDir, "latest.jpg");
  fs.writeFileSync(latestPath, imageData);

  // Update motion log
  const logPath = path.join(cameraDir, "motion_log.json");
  const log = readJson<MotionLogEntry[]>(logPath, []);
  
  log.push({
    timestamp,
    motionScore,
    facing,
    sensitivity,
    file: fileName,
  });

  // Keep only last MAX_LOG_ENTRIES
  if (log.length > MAX_LOG_ENTRIES) {
    log.splice(0, log.length - MAX_LOG_ENTRIES);
  }
  
  writeJson(logPath, log);

  // Prune old captures
  pruneCaptures(capturesDir, ctx.logger);

  ctx.logger.info(`[camera] Motion event logged (${log.length} entries total)`);
}
