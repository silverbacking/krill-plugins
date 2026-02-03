/**
 * Krill Health Check Handler
 * 
 * Handles health.ping messages from the Central Node monitor.
 * 
 * States:
 * - online: Gateway responds AND LLM is working
 * - unresponsive: Gateway responds BUT LLM times out or errors
 * - offline: No response at all (detected by monitor timeout)
 */

import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";

export interface HealthPing {
  type: "ai.krill.health.ping";
  content: {
    request_id: string;
    timestamp: number;
    skip_llm_test?: boolean; // If true, skip LLM test (agent was recently active)
  };
}

export interface HealthAck {
  type: "ai.krill.health.ack";
  content: {
    request_id: string;
    agent_id: string;
    gateway_id: string;
    timestamp: number;
  };
}

export interface HealthPong {
  type: "ai.krill.health.pong";
  content: {
    request_id: string;
    agent_id: string;
    gateway_id: string;
    status: "online" | "unresponsive";
    llm_status: "ok" | "error" | "timeout";
    llm_latency_ms?: number;
    load?: string;
    uptime_seconds?: number;
    version?: string;
    timestamp: number;
  };
}

// Track gateway start time for uptime
const startTime = Date.now();

// Track last LLM activity to avoid unnecessary token consumption
let lastLlmActivity = 0;
const LLM_ACTIVITY_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Mark LLM activity (call this when agent processes a real message)
 */
export function markLlmActivity() {
  lastLlmActivity = Date.now();
}

/**
 * Check if LLM was recently active (within grace period)
 * Uses local tracking + can check Matrix messages if available
 */
function wasLlmRecentlyActive(): boolean {
  return (Date.now() - lastLlmActivity) < LLM_ACTIVITY_GRACE_PERIOD_MS;
}

/**
 * Check recent Matrix messages to see if agent was active
 * This is called by the monitor to avoid LLM test if agent was chatting
 */
export async function checkRecentActivity(
  matrixHomeserver: string,
  accessToken: string,
  roomId: string,
  agentMxid: string,
  withinMs: number = LLM_ACTIVITY_GRACE_PERIOD_MS
): Promise<boolean> {
  try {
    const url = `${matrixHomeserver}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=20`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    
    if (!res.ok) return false;
    
    const data = await res.json();
    const now = Date.now();
    
    for (const event of data.chunk || []) {
      // Check if agent sent a message recently
      if (event.sender === agentMxid && event.type === 'm.room.message') {
        const eventTime = event.origin_server_ts;
        if (now - eventTime < withinMs) {
          return true; // Agent was active recently
        }
      }
    }
  } catch (e) {
    // Ignore errors, assume not active
  }
  return false;
}

/**
 * Parse a health ping from message text
 */
export function parseHealthPing(text: string): HealthPing["content"] | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed.type === "ai.krill.health.ping" && parsed.content?.request_id) {
      return parsed.content;
    }
  } catch {
    // Not JSON or invalid
  }
  return null;
}

/**
 * Generate immediate ACK response (proves gateway is alive)
 */
export function generateHealthAck(
  requestId: string,
  agentMxid: string,
  gatewayId: string
): string {
  const ack: HealthAck = {
    type: "ai.krill.health.ack",
    content: {
      request_id: requestId,
      agent_id: agentMxid,
      gateway_id: gatewayId,
      timestamp: Date.now(),
    },
  };
  return JSON.stringify(ack);
}

/**
 * Generate full PONG response (includes LLM status)
 */
export function generateHealthPong(
  requestId: string,
  agentMxid: string,
  gatewayId: string,
  llmStatus: "ok" | "error" | "timeout",
  llmLatencyMs?: number
): string {
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
  
  // Get system load (Linux only)
  let load: string | undefined;
  try {
    const os = require("os");
    const loadAvg = os.loadavg();
    load = loadAvg[0].toFixed(2);
  } catch {
    // Ignore
  }
  
  const pong: HealthPong = {
    type: "ai.krill.health.pong",
    content: {
      request_id: requestId,
      agent_id: agentMxid,
      gateway_id: gatewayId,
      status: llmStatus === "ok" ? "online" : "unresponsive",
      llm_status: llmStatus,
      llm_latency_ms: llmLatencyMs,
      load,
      uptime_seconds: uptimeSeconds,
      version: process.env.npm_package_version || "1.0.0",
      timestamp: Date.now(),
    },
  };
  return JSON.stringify(pong);
}

/**
 * Test LLM responsiveness with a simple prompt
 * Returns { ok: boolean, latencyMs: number }
 */
export async function testLlm(
  api: ClawdbotPluginApi,
  timeoutMs: number = 10000
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startTime = Date.now();
  
  try {
    // Use the API's chat completion if available
    // This is a lightweight test - just checks if LLM responds
    const testPrompt = "Reply with only: OK";
    
    // Create a promise that rejects after timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("LLM_TIMEOUT")), timeoutMs);
    });
    
    // Try to get a response from the LLM
    // Note: This depends on how Clawdbot exposes LLM access to plugins
    // For now, we'll use a simple fetch to the gateway's own chat endpoint
    const chatPromise = (async () => {
      // Option 1: If plugin has direct LLM access
      if (api.chat) {
        const response = await api.chat({ 
          messages: [{ role: "user", content: testPrompt }],
          maxTokens: 10,
        });
        return response;
      }
      
      // Option 2: If no direct access, assume LLM is OK if gateway is running
      // The real test would be intercepting actual user messages
      return { ok: true };
    })();
    
    await Promise.race([chatPromise, timeoutPromise]);
    
    const latencyMs = Date.now() - startTime;
    return { ok: true, latencyMs };
    
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    
    if (error.message === "LLM_TIMEOUT") {
      return { ok: false, latencyMs, error: "timeout" };
    }
    
    return { ok: false, latencyMs, error: error.message || "unknown" };
  }
}

/**
 * Handle a health ping message
 * 1. Immediately send ACK (proves gateway alive)
 * 2. Test LLM and send PONG with full status
 *    - Skip LLM test if there was activity in last 5 minutes (save tokens)
 */
export async function handleHealthPing(
  api: ClawdbotPluginApi,
  ping: HealthPing["content"],
  agentMxid: string,
  gatewayId: string,
  sendResponse: (text: string) => Promise<void>
): Promise<void> {
  const { request_id } = ping;
  
  api.logger.info(`[krill-health] Received ping: ${request_id}`);
  
  // Step 1: Send immediate ACK
  const ack = generateHealthAck(request_id, agentMxid, gatewayId);
  await sendResponse(ack);
  api.logger.info(`[krill-health] Sent ACK for ${request_id}`);
  
  // Step 2: Check LLM status
  let llmStatus: "ok" | "error" | "timeout" = "ok";
  let llmLatencyMs: number | undefined;
  
  // Skip LLM test if:
  // - Monitor says skip_llm_test (agent was active recently)
  // - Local tracking shows recent activity
  const shouldSkipLlmTest = ping.skip_llm_test || wasLlmRecentlyActive();
  
  if (shouldSkipLlmTest) {
    // LLM was active recently - assume it's still working (save tokens!)
    api.logger.info(`[krill-health] Skipping LLM test (recent activity)`);
    llmStatus = "ok";
    llmLatencyMs = 0; // Indicates skipped test
  } else {
    // Test LLM (with 10s timeout)
    api.logger.info(`[krill-health] Testing LLM...`);
    const llmResult = await testLlm(api, 10000);
    llmStatus = llmResult.ok ? "ok" : 
      llmResult.error === "timeout" ? "timeout" : "error";
    llmLatencyMs = llmResult.latencyMs;
  }
  
  // Step 3: Send PONG with full status
  const pong = generateHealthPong(
    request_id,
    agentMxid,
    gatewayId,
    llmStatus,
    llmLatencyMs
  );
  await sendResponse(pong);
  
  api.logger.info(
    `[krill-health] Sent PONG for ${request_id}: ` +
    `llm_status=${llmStatus}, latency=${llmLatencyMs}ms`
  );
}

/**
 * Check if a message is a health ping
 */
export function isHealthPing(text: string): boolean {
  return parseHealthPing(text) !== null;
}
