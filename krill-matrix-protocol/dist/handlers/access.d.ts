/**
 * Access Handler
 *
 * Manages PIN verification for new users who are on the allowlist
 * but haven't completed pairing yet.
 *
 * Works with both Krill App (via ai.krill.pair.*) and regular Matrix
 * clients (via text messages asking for PIN).
 */
export interface AccessState {
    verified: {
        [mxid: string]: {
            verifiedAt: number;
            userId?: string;
            email?: string;
        };
    };
    pendingPin: {
        [mxid: string]: {
            promptedAt: number;
            attempts: number;
        };
    };
}
export interface AccessHandlerOptions {
    storagePath: string;
    krillApiUrl: string;
    maxPinAttempts?: number;
    pinPromptMessage?: string;
    pinSuccessMessage?: string;
    pinFailureMessage?: string;
    pinBlockedMessage?: string;
    logger: {
        info: (msg: string) => void;
        warn: (msg: string) => void;
    };
}
/**
 * Initialize the access handler
 */
export declare function initAccessHandler(opts: AccessHandlerOptions): void;
/**
 * Check if a user has completed PIN verification
 */
export declare function isVerified(mxid: string): boolean;
/**
 * Check if a user is currently being prompted for PIN
 */
export declare function isPendingPin(mxid: string): boolean;
/**
 * Handle access check for a message
 *
 * Returns:
 * - { allowed: true } if user is verified
 * - { allowed: false, response: "..." } if user needs PIN or verification failed
 */
export declare function handleAccess(mxid: string, messageText: string): Promise<{
    allowed: boolean;
    response?: string;
}>;
/**
 * Mark a user as verified (for Krill App flow that uses ai.krill.pair.*)
 */
export declare function markVerified(mxid: string, userId?: string, email?: string): void;
/**
 * Revoke access for a user
 */
export declare function revokeAccess(mxid: string): void;
/**
 * Get all verified users
 */
export declare function getVerifiedUsers(): string[];
