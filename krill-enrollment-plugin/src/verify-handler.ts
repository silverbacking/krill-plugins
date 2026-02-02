/**
 * Krill Verification Handler
 * 
 * Handles ai.krill.verify.request events and responds with ai.krill.verify.response
 * 
 * This module is designed to be called when the gateway receives a Matrix event
 * with type "ai.krill.verify.request".
 */

export interface VerifyRequestContent {
  challenge: string;
  timestamp: number;
  app_version?: string;
}

export interface VerifyResponseContent {
  challenge: string;
  verified: boolean;
  agent?: {
    mxid: string;
    display_name: string;
    gateway_id: string;
    capabilities: string[];
    status: string;
  };
  error?: string;
  message?: string;
  responded_at: number;
}

export interface KrillAgentConfig {
  mxid: string;
  displayName: string;
  description?: string;
  capabilities?: string[];
}

export interface KrillVerifyConfig {
  gatewayId: string;
  agents: KrillAgentConfig[];
  challengeMaxAgeSeconds?: number;  // Default: 60
}

/**
 * Process a verification request and generate a response
 */
export function processVerifyRequest(
  request: VerifyRequestContent,
  agentMxid: string,
  config: KrillVerifyConfig
): VerifyResponseContent {
  const now = Math.floor(Date.now() / 1000);
  const maxAge = config.challengeMaxAgeSeconds ?? 60;

  // Validate timestamp (challenge not too old)
  if (request.timestamp && (now - request.timestamp) > maxAge) {
    return {
      challenge: request.challenge,
      verified: false,
      error: "CHALLENGE_EXPIRED",
      message: `El challenge ha expirat (> ${maxAge} segons)`,
      responded_at: now,
    };
  }

  // Find the agent in config
  const agent = config.agents.find(a => a.mxid === agentMxid);
  
  if (!agent) {
    return {
      challenge: request.challenge,
      verified: false,
      error: "AGENT_NOT_FOUND",
      message: "Aquest agent no està configurat al gateway",
      responded_at: now,
    };
  }

  // Success response
  return {
    challenge: request.challenge,
    verified: true,
    agent: {
      mxid: agent.mxid,
      display_name: agent.displayName,
      gateway_id: config.gatewayId,
      capabilities: agent.capabilities || ["chat"],
      status: "online",
    },
    responded_at: now,
  };
}

/**
 * Create a Matrix event for the verification response
 */
export function createVerifyResponseEvent(
  response: VerifyResponseContent
): { type: string; content: VerifyResponseContent } {
  return {
    type: "ai.krill.verify.response",
    content: response,
  };
}

/**
 * Check if a Matrix event is a Krill verify request
 */
export function isVerifyRequest(event: { type?: string }): boolean {
  return event.type === "ai.krill.verify.request";
}

/**
 * Example usage:
 * 
 * ```typescript
 * // When a Matrix event arrives:
 * if (isVerifyRequest(event)) {
 *   const response = processVerifyRequest(
 *     event.content,
 *     "@jarvis:matrix.silverbacking.ai",
 *     {
 *       gatewayId: "jarvis-gateway-001",
 *       agents: [{ mxid: "@jarvis:...", displayName: "Jarvis" }]
 *     }
 *   );
 *   
 *   // Send response back via Matrix
 *   await matrixClient.sendEvent(
 *     roomId,
 *     "ai.krill.verify.response",
 *     response
 *   );
 * }
 * ```
 */
