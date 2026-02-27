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
const DEFAULT_THRESHOLD_METERS = 50;
const GEOCODE_CACHE_MAX = 500;
const NOMINATIM_USER_AGENT = "KrillBot/1.0 (krill-matrix-protocol)";
/**
 * Reverse geocode coordinates to a place name using Nominatim (OpenStreetMap).
 * Uses local cache to avoid repeated lookups for nearby locations.
 * Returns null on failure (non-blocking, best-effort).
 */
async function reverseGeocode(lat, lon, storagePath, logger) {
    // Round to ~100m precision for cache key (3 decimal places)
    const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    // Check cache
    const cachePath = path.join(storagePath, "geocache.json");
    const cache = readJson(cachePath, {});
    if (cache[cacheKey]) {
        return cache[cacheKey].name;
    }
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=16&addressdetails=1`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(url, {
            headers: { "User-Agent": NOMINATIM_USER_AGENT },
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok)
            return null;
        const data = await response.json();
        const addr = data.address || {};
        // Build a human-readable name: neighborhood/suburb, city, country
        const parts = [];
        const local = addr.neighbourhood || addr.suburb || addr.quarter || addr.hamlet || addr.village || "";
        const city = addr.city || addr.town || addr.municipality || "";
        const state = addr.state || "";
        const country = addr.country || "";
        if (local)
            parts.push(local);
        if (city && city !== local)
            parts.push(city);
        if (state && state !== city)
            parts.push(state);
        if (country)
            parts.push(country);
        const placeName = parts.join(", ") || data.display_name || null;
        if (placeName) {
            // Save to cache (trim if too large)
            cache[cacheKey] = { name: placeName, ts: Date.now() };
            if (Object.keys(cache).length > GEOCODE_CACHE_MAX) {
                // Remove oldest entries
                const entries = Object.entries(cache).sort((a, b) => a[1].ts - b[1].ts);
                const toRemove = entries.slice(0, entries.length - GEOCODE_CACHE_MAX + 100);
                for (const [k] of toRemove)
                    delete cache[k];
            }
            writeJson(cachePath, cache);
            logger.info(`[senses/location] 📍 Geocoded: ${placeName}`);
        }
        return placeName;
    }
    catch (err) {
        logger.debug(`[senses/location] Geocode failed (non-fatal): ${err.message || err}`);
        return null;
    }
}
/**
 * Haversine distance between two points in meters
 */
function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}
function readJson(filePath, fallback) {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, "utf-8"));
        }
    }
    catch { /* corrupted file, use fallback */ }
    return fallback;
}
function writeJson(filePath, data) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}
function todayDateString() {
    // Use local date for file naming
    const now = new Date();
    return now.toISOString().slice(0, 10);
}
/**
 * Main location handler
 */
export async function handleLocation(ctx) {
    const { content, logger, config } = ctx;
    const storagePath = config.storagePath;
    const threshold = config.location?.movementThresholdMeters ?? DEFAULT_THRESHOLD_METERS;
    // Parse incoming location
    const point = {
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
    const current = readJson(currentPath, null);
    // Check if movement is significant
    let isSignificant = true;
    if (current?.current) {
        const dist = distanceMeters(current.current.latitude, current.current.longitude, point.latitude, point.longitude);
        isSignificant = dist >= threshold;
        if (!isSignificant) {
            logger.debug(`[senses/location] Movement ${dist.toFixed(0)}m < ${threshold}m threshold — skipping`);
            // Still update current.json timestamp for freshness, but don't log to history
            const updated = {
                ...current,
                current: { ...current.current, timestamp: point.timestamp },
                updatedAt: new Date().toISOString(),
            };
            writeJson(currentPath, updated);
            return;
        }
        logger.info(`[senses/location] Significant movement: ${dist.toFixed(0)}m`);
    }
    else {
        logger.info(`[senses/location] First location fix: ${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`);
    }
    // === Significant movement: update everything ===
    // 1. Reverse geocode (async, best-effort)
    const placeName = await reverseGeocode(point.latitude, point.longitude, storagePath, logger);
    // 2. Update current.json
    const geofenceName = getCurrentGeofence(point, storagePath);
    const newCurrent = {
        current: point,
        geofence: geofenceName || undefined,
        placeName: placeName || undefined,
        updatedAt: new Date().toISOString(),
    };
    writeJson(currentPath, newCurrent);
    // 2. Append to daily history
    const historyDir = path.join(storagePath, "history");
    const historyPath = path.join(historyDir, `${todayDateString()}.json`);
    const history = readJson(historyPath, []);
    history.push(point);
    writeJson(historyPath, history);
    // 3. Check geofences
    await checkGeofences(point, ctx);
}
/**
 * Get the name of the geofence the point is currently in (if any)
 */
function getCurrentGeofence(point, storagePath) {
    const geofencesPath = path.join(storagePath, "geofences.json");
    const geofences = readJson(geofencesPath, {});
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
async function checkGeofences(point, ctx) {
    const { config, reply, logger } = ctx;
    const storagePath = config.storagePath;
    const geofencesPath = path.join(storagePath, "geofences.json");
    const statePath = path.join(storagePath, "geofence-state.json");
    const geofences = readJson(geofencesPath, {});
    if (Object.keys(geofences).length === 0)
        return;
    const state = readJson(statePath, {});
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
        }
        else if (!isInside && wasInside) {
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
