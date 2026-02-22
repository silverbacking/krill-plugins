/**
 * Location Sense Handler
 * 
 * Handles ai.krill.sense.location messages from paired users.
 * - Logs location updates to LOCATION_HISTORY.md
 * - Updates last known location for AI context injection
 */
import fs from "fs";
import path from "path";

// In-memory cache of last known location per user
const lastLocations = new Map();

/**
 * Handle incoming location update
 */
async function handleLocationUpdate(config, content, senderId, logger) {
  const { latitude, longitude, accuracy, altitude, speed, heading, timestamp } = content;
  
  if (latitude == null || longitude == null) {
    logger?.warn("[krill-location] Missing lat/lon in location update");
    return true; // handled (don't pass to LLM)
  }
  
  const ts = timestamp ? new Date(timestamp * 1000) : new Date();
  const isoTime = ts.toISOString();
  
  logger?.info(`[krill-location] 📍 ${senderId}: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${(accuracy || 0).toFixed(0)}m)`);
  
  // Update in-memory last location
  lastLocations.set(senderId, {
    latitude,
    longitude,
    accuracy,
    altitude,
    speed,
    heading,
    timestamp: isoTime,
    senderId,
  });
  
  // Append to LOCATION_HISTORY.md
  try {
    const historyPath = _getHistoryPath(config);
    const entry = `| ${isoTime} | ${senderId} | ${latitude.toFixed(6)} | ${longitude.toFixed(6)} | ${(accuracy || 0).toFixed(0)}m | ${(altitude || 0).toFixed(1)}m | ${(speed || 0).toFixed(1)}m/s |\n`;
    
    // Create file with header if it doesn't exist
    if (!fs.existsSync(historyPath)) {
      const header = `# Location History\n\n| Timestamp | User | Latitude | Longitude | Accuracy | Altitude | Speed |\n|-----------|------|----------|-----------|----------|----------|-------|\n`;
      fs.writeFileSync(historyPath, header, "utf-8");
    }
    
    fs.appendFileSync(historyPath, entry, "utf-8");
  } catch (e) {
    logger?.error(`[krill-location] Failed to write history: ${e.message}`);
  }
  
  // Update LAST_LOCATION.md for AI context
  try {
    const lastLocPath = _getLastLocationPath(config);
    const locText = `# Last Known Location\n\n` +
      `- **User:** ${senderId}\n` +
      `- **Time:** ${isoTime}\n` +
      `- **Coordinates:** ${latitude.toFixed(6)}, ${longitude.toFixed(6)}\n` +
      `- **Accuracy:** ${(accuracy || 0).toFixed(0)}m\n` +
      `- **Altitude:** ${(altitude || 0).toFixed(1)}m\n` +
      `- **Speed:** ${(speed || 0).toFixed(1)} m/s\n` +
      `- **Heading:** ${(heading || 0).toFixed(0)}°\n\n` +
      `*Updated automatically by krill-matrix-protocol*\n`;
    fs.writeFileSync(lastLocPath, locText, "utf-8");
  } catch (e) {
    logger?.error(`[krill-location] Failed to write last location: ${e.message}`);
  }
  
  return true; // handled - don't pass to LLM
}

/**
 * Get last known location for a user (for context injection)
 */
function getLastLocation(senderId) {
  if (senderId) return lastLocations.get(senderId);
  // Return any last location if no senderId specified
  const entries = [...lastLocations.values()];
  return entries.length > 0 ? entries[entries.length - 1] : null;
}

/**
 * Get path for LOCATION_HISTORY.md
 */
function _getHistoryPath(config) {
  const storagePath = config?.storagePath;
  if (storagePath) {
    return path.join(path.dirname(storagePath), "LOCATION_HISTORY.md");
  }
  return path.join(process.env.HOME || "/tmp", "LOCATION_HISTORY.md");
}

/**
 * Get path for LAST_LOCATION.md
 */
function _getLastLocationPath(config) {
  const storagePath = config?.storagePath;
  if (storagePath) {
    return path.join(path.dirname(storagePath), "LAST_LOCATION.md");
  }
  return path.join(process.env.HOME || "/tmp", "LAST_LOCATION.md");
}

export const handleLocation = {
  update: handleLocationUpdate,
  getLastLocation,
};
