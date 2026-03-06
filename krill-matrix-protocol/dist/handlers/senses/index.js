"use strict";
/**
 * Senses Dispatcher
 *
 * Intercepts ai.krill.sense.* messages and routes to specific handlers.
 * Sense data is NOT forwarded to the LLM — it's stored to disk
 * and only significant events (geofence enter/exit) notify the agent.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSense = handleSense;
const location_js_1 = require("./location.js");
const audio_js_1 = require("./audio.js");
const camera_js_1 = require("./camera.js");
const microphone_js_1 = require("./microphone.js");
/**
 * Route a sense message to the appropriate handler.
 * Returns true if handled.
 */
async function handleSense(ctx) {
    const senseType = ctx.type.replace("ai.krill.sense.", "");
    switch (senseType) {
        case "location":
            await (0, location_js_1.handleLocation)(ctx);
            return true;
        case "audio":
            await (0, audio_js_1.handleAudio)(ctx);
            return true;
        case "camera":
            await (0, camera_js_1.handleCamera)(ctx);
            return true;
        case "camera.end":
            // End-of-sequence — just log it, no action needed (agent gets notified by plugin)
            ctx.logger.info(`[senses] Camera session ended: ${JSON.stringify(ctx.content)}`);
            return true;
        case "microphone":
            await (0, microphone_js_1.handleMicrophone)(ctx);
            return true;
        // Future senses:
        // case "email":
        default:
            ctx.logger.warn(`[senses] Unknown sense type: ${senseType}`);
            return false;
    }
}
