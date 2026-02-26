/**
 * Senses Dispatcher
 *
 * Intercepts ai.krill.sense.* messages and routes to specific handlers.
 * Sense data is NOT forwarded to the LLM — it's stored to disk
 * and only significant events (geofence enter/exit) notify the agent.
 */
import { handleLocation } from "./location.js";
/**
 * Route a sense message to the appropriate handler.
 * Returns true if handled.
 */
export async function handleSense(ctx) {
    const senseType = ctx.type.replace("ai.krill.sense.", "");
    switch (senseType) {
        case "location":
            await handleLocation(ctx);
            return true;
        // Future senses:
        // case "camera":
        // case "audio":
        // case "email":
        default:
            ctx.logger.warn(`[senses] Unknown sense type: ${senseType}`);
            return false;
    }
}
