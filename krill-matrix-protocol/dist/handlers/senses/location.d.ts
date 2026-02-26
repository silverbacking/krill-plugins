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
import type { SenseContext } from "./types.js";
/**
 * Main location handler
 */
export declare function handleLocation(ctx: SenseContext): Promise<void>;
