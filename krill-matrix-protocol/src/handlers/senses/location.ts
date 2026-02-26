/**
 * Location Sense Handler
 * 
 * Processes ai.krill.sense.location messages:
 * 1. Compares with last known position
 * 2. If significant movement (>threshold): updates current.json + daily history
 * 3. Checks geofences → notifies agent on enter/exit
 * 4. If no significant movement: silently discards
 * 
 * File structure:
 *   <storagePath>/
 *     current.json          ← latest position (always fresh)
 *     geofences.json        ← geofence definitions (user-editable)
 *     geofence-state.json   ← current enter/exit state
 *     history/
 *       2026-02-26.json     ← daily history (array of points)
 *       2026-02-25.json
 */

import fs from "fs";
import path from "path";
import type { 
  SenseContext, LocationPoint, CurrentLocation, 
  Geofence, GeofenceState 
} from "./types.js";

const DEFAULT_THRESHOLD_METERS = 50;

/**
 * Haversine distance between two points in meters
 */
function distanceMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch { /* corrupted file, use fallback */ }
  return fallback;
}

function writeJson(filePath: string, data: any): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function todayDateString(): string {
  // Use local date for file naming
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

/**
 * Main location handler
 */
export async function handleLocation(ctx: SenseContext): Promise<void> {
  const { content, logger, config } = ctx;
  const storagePath = config.storagePath;
  const threshold = config.location?.movementThresholdMeters ?? DEFAULT_THRESHOLD_METERS;
  
  // Parse incoming location
  const point: LocationPoint = {
    latitude: content.latitude,
    longitude: content.longitude,
    accuracy: content.accuracy,
    altitude: content.altitude,
    speed: content.speed,
    heading: content.heading,
    timestamp: content.timestamp 
      ? new Date(content.timestamp * 1000).toISOString()
      : new Date().toISOString(),
  };
  
  if (!point.latitude || !point.longitude) {
    logger.warn("[senses/location] Invalid location data — missing lat/lng");
    return;
  }
  
  // Read current position
  const currentPath = path.join(storagePath, "current.json");
  const current = readJson<CurrentLocation | null>(currentPath, null);
  
  // Check if movement is significant
  let isSignificant = true;
  if (current?.current) {
    const dist = distanceMeters(
      current.current.latitude, current.current.longitude,
      point.latitude, point.longitude
    );
    isSignificant = dist >= threshold;
    
    if (!isSignificant) {
      logger.debug(`[senses/location] Movement ${dist.toFixed(0)}m < ${threshold}m threshold — skipping`);
      // Still update current.json timestamp for freshness, but don't log to history
      const updated: CurrentLocation = {
        ...current,
        current: { ...current.current, timestamp: point.timestamp },
        updatedAt: new Date().toISOString(),
      };
      writeJson(currentPath, updated);
      return;
    }
    
    logger.info(`[senses/location] Significant movement: ${dist.toFixed(0)}m`);
  } else {
    logger.info(`[senses/location] First location fix: ${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`);
  }
  
  // === Significant movement: update everything ===
  
  // 1. Update current.json
  const geofenceName = getCurrentGeofence(point, storagePath);
  const newCurrent: CurrentLocation = {
    current: point,
    geofence: geofenceName || undefined,
    updatedAt: new Date().toISOString(),
  };
  writeJson(currentPath, newCurrent);
  
  // 2. Append to daily history
  const historyDir = path.join(storagePath, "history");
  const historyPath = path.join(historyDir, `${todayDateString()}.json`);
  const history = readJson<LocationPoint[]>(historyPath, []);
  history.push(point);
  writeJson(historyPath, history);
  
  // 3. Check geofences
  await checkGeofences(point, ctx);
}

/**
 * Get the name of the geofence the point is currently in (if any)
 */
function getCurrentGeofence(point: LocationPoint, storagePath: string): string | null {
  const geofencesPath = path.join(storagePath, "geofences.json");
  const geofences = readJson<Record<string, Geofence>>(geofencesPath, {});
  
  for (const [id, gf] of Object.entries(geofences)) {
    const dist = distanceMeters(point.latitude, point.longitude, gf.latitude, gf.longitude);
    if (dist <= gf.radiusMeters) {
      return gf.name;
    }
  }
  return null;
}

/**
 * Check geofences and notify agent on enter/exit
 */
async function checkGeofences(point: LocationPoint, ctx: SenseContext): Promise<void> {
  const { config, reply, logger } = ctx;
  const storagePath = config.storagePath;
  
  const geofencesPath = path.join(storagePath, "geofences.json");
  const statePath = path.join(storagePath, "geofence-state.json");
  
  const geofences = readJson<Record<string, Geofence>>(geofencesPath, {});
  if (Object.keys(geofences).length === 0) return;
  
  const state = readJson<GeofenceState>(statePath, {});
  let stateChanged = false;
  
  for (const [id, gf] of Object.entries(geofences)) {
    const dist = distanceMeters(point.latitude, point.longitude, gf.latitude, gf.longitude);
    const isInside = dist <= gf.radiusMeters;
    const wasInside = state[id]?.inside ?? false;
    
    if (isInside && !wasInside) {
      // ENTER
      state[id] = { inside: true, since: point.timestamp };
      stateChanged = true;
      logger.info(`[senses/location] 📍 Geofence ENTER: ${gf.name}`);
      await reply(JSON.stringify({
        type: "ai.krill.sense.geofence",
        content: {
          event: "enter",
          geofence: id,
          name: gf.name,
          latitude: point.latitude,
          longitude: point.longitude,
          timestamp: point.timestamp,
        }
      }));
    } else if (!isInside && wasInside) {
      // EXIT
      const enteredAt = state[id]?.since;
      state[id] = { inside: false };
      stateChanged = true;
      logger.info(`[senses/location] 📍 Geofence EXIT: ${gf.name}`);
      await reply(JSON.stringify({
        type: "ai.krill.sense.geofence",
        content: {
          event: "exit",
          geofence: id,
          name: gf.name,
          latitude: point.latitude,
          longitude: point.longitude,
          timestamp: point.timestamp,
          duration: enteredAt ? `since ${enteredAt}` : undefined,
        }
      }));
    }
  }
  
  if (stateChanged) {
    writeJson(statePath, state);
  }
}
