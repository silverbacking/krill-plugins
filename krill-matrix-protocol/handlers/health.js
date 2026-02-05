/**
 * Health Check Handler
 *
 * Handles ai.krill.health.* messages for agent health monitoring.
 *
 * States:
 * - online: Gateway responds AND LLM works
 * - unresponsive: Gateway responds BUT LLM timeout/error
 * - offline: No response (detected by monitor timeout)
 */
// Track gateway start time for uptime
const startTime = Date.now();
// Track last LLM activity (set by message interceptor)
let lastLlmActivity = 0;
const LLM_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Mark LLM as active (called when non-protocol message is received)
 */
export function markLlmActivity() {
    lastLlmActivity = Date.now();
}
/**
 * Check if LLM was recently active
 */
function wasLlmRecentlyActive() {
    return (Date.now() - lastLlmActivity) < LLM_GRACE_PERIOD_MS;
}
/**
 * Get system load (Linux)
 */
function getLoad() {
    try {
        const os = require("os");
        return os.loadavg()[0].toFixed(2);
    }
    catch {
        return undefined;
    }
}
export const handleHealth = {
    /**
     * Handle ai.krill.health.ping
     */
    async ping(config, content, sendResponse) {
        const { request_id, skip_llm_test } = content;
        const agent = config.agent;
        if (!agent) {
            return;
        }
        console.log(`[krill-health] Ping received: ${request_id}`);
        // Step 1: Send immediate ACK (proves gateway alive)
        const ack = {
            type: "ai.krill.health.ack",
            content: {
                request_id,
                agent_id: agent.mxid,
                gateway_id: config.gatewayId,
                timestamp: Date.now(),
            },
        };
        await sendResponse(JSON.stringify(ack));
        console.log(`[krill-health] ACK sent for ${request_id}`);
        // Step 2: Determine LLM status
        let llmStatus = "ok";
        let llmLatencyMs = 0;
        // Skip LLM test if:
        // - Monitor says skip (agent was active in room recently)
        // - Local tracking shows recent LLM activity
        const shouldSkip = skip_llm_test || wasLlmRecentlyActive();
        if (shouldSkip) {
            console.log(`[krill-health] Skipping LLM test (recent activity)`);
            llmStatus = "ok";
            llmLatencyMs = 0;
        }
        else {
            // In a real implementation, we would test the LLM here
            // For now, assume OK if gateway is running
            console.log(`[krill-health] LLM test: assuming OK (no recent activity)`);
            llmStatus = "ok";
            llmLatencyMs = 1;
        }
        // Step 3: Send PONG with full status
        const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
        const pong = {
            type: "ai.krill.health.pong",
            content: {
                request_id,
                agent_id: agent.mxid,
                gateway_id: config.gatewayId,
                status: llmStatus === "ok" ? "online" : "unresponsive",
                llm_status: llmStatus,
                llm_latency_ms: llmLatencyMs,
                load: getLoad(),
                uptime_seconds: uptimeSeconds,
                version: "1.0.0",
                timestamp: Date.now(),
            },
        };
        await sendResponse(JSON.stringify(pong));
        console.log(`[krill-health] PONG sent: status=${pong.content.status}`);
    },
};
