/**
 * Senses Dispatcher
 *
 * Intercepts ai.krill.sense.* messages and routes to specific handlers.
 * Sense data is NOT forwarded to the LLM — it's stored to disk
 * and only significant events (geofence enter/exit) notify the agent.
 */
import type { SenseContext } from "./types.js";
/**
 * Route a sense message to the appropriate handler.
 * Returns true if handled.
 */
export declare function handleSense(ctx: SenseContext): Promise<boolean>;
