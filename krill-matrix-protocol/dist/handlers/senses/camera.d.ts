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
import type { SenseContext } from "./types.js";
export declare function handleCamera(ctx: SenseContext): Promise<void>;
