"use strict";
/**
 * Access Handler
 *
 * Manages PIN verification for new users who are on the allowlist
 * but haven't completed pairing yet.
 *
 * Works with both Krill App (via ai.krill.pair.*) and regular Matrix
 * clients (via text messages asking for PIN).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAccessHandler = initAccessHandler;
exports.isVerified = isVerified;
exports.isPendingPin = isPendingPin;
exports.handleAccess = handleAccess;
exports.markVerified = markVerified;
exports.revokeAccess = revokeAccess;
exports.getVerifiedUsers = getVerifiedUsers;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
let options = null;
let state = { verified: {}, pendingPin: {} };
const DEFAULT_PIN_PROMPT = "🔐 Benvingut! Per verificar la teva identitat, introdueix el teu PIN de krillbot.network:";
const DEFAULT_PIN_SUCCESS = "✅ Identitat verificada! Com puc ajudar-te?";
const DEFAULT_PIN_FAILURE = "❌ PIN incorrecte. Torna a provar:";
const DEFAULT_PIN_BLOCKED = "🚫 Massa intents fallits. Contacta amb el propietari de l'agent.";
/**
 * Load state from disk
 */
function loadState() {
    if (!options?.storagePath)
        return;
    const statePath = path_1.default.join(options.storagePath, "access-state.json");
    try {
        if (fs_1.default.existsSync(statePath)) {
            state = JSON.parse(fs_1.default.readFileSync(statePath, "utf-8"));
        }
    }
    catch (error) {
        options?.logger.warn(`[access] Failed to load state: ${error}`);
    }
}
/**
 * Save state to disk
 */
function saveState() {
    if (!options?.storagePath)
        return;
    const statePath = path_1.default.join(options.storagePath, "access-state.json");
    try {
        const dir = path_1.default.dirname(statePath);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        fs_1.default.writeFileSync(statePath, JSON.stringify(state, null, 2));
    }
    catch (error) {
        options?.logger.warn(`[access] Failed to save state: ${error}`);
    }
}
/**
 * Initialize the access handler
 */
function initAccessHandler(opts) {
    options = opts;
    loadState();
    options.logger.info(`[access] Initialized with ${Object.keys(state.verified).length} verified users`);
}
/**
 * Check if a user has completed PIN verification
 */
function isVerified(mxid) {
    return !!state.verified[mxid];
}
/**
 * Check if a user is currently being prompted for PIN
 */
function isPendingPin(mxid) {
    return !!state.pendingPin[mxid];
}
/**
 * Verify PIN with Krill API
 */
async function verifyPinWithApi(mxid, pin) {
    if (!options?.krillApiUrl) {
        options?.logger.warn(`[access] No API URL configured`);
        return { valid: false };
    }
    try {
        // Create challenge for PIN verification
        const response = await fetch(`${options.krillApiUrl}/v1/pairing/verify-pin`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mxid, pin }),
        });
        if (!response.ok) {
            return { valid: false };
        }
        const data = await response.json();
        return {
            valid: data.valid === true,
            userId: data.userId,
            email: data.email,
        };
    }
    catch (error) {
        options?.logger.warn(`[access] API verification failed: ${error}`);
        return { valid: false };
    }
}
/**
 * Handle access check for a message
 *
 * Returns:
 * - { allowed: true } if user is verified
 * - { allowed: false, response: "..." } if user needs PIN or verification failed
 */
async function handleAccess(mxid, messageText) {
    if (!options) {
        return { allowed: true }; // Handler not initialized, allow all
    }
    // Already verified? Allow through
    if (isVerified(mxid)) {
        return { allowed: true };
    }
    const maxAttempts = options.maxPinAttempts || 5;
    // Check if user is pending PIN entry
    if (isPendingPin(mxid)) {
        const pending = state.pendingPin[mxid];
        // Too many attempts?
        if (pending.attempts >= maxAttempts) {
            return {
                allowed: false,
                response: options.pinBlockedMessage || DEFAULT_PIN_BLOCKED,
            };
        }
        // Try to verify the message as a PIN
        const pin = messageText.trim();
        // PIN should be 6 digits
        if (!/^\d{6}$/.test(pin)) {
            // Not a valid PIN format, prompt again
            pending.attempts++;
            saveState();
            return {
                allowed: false,
                response: options.pinFailureMessage || DEFAULT_PIN_FAILURE,
            };
        }
        // Verify with API
        const result = await verifyPinWithApi(mxid, pin);
        if (result.valid) {
            // Success! Mark as verified
            delete state.pendingPin[mxid];
            state.verified[mxid] = {
                verifiedAt: Date.now(),
                userId: result.userId,
                email: result.email,
            };
            saveState();
            options.logger.info(`[access] ✅ User ${mxid} verified successfully`);
            return {
                allowed: false, // Don't process the PIN as a message
                response: options.pinSuccessMessage || DEFAULT_PIN_SUCCESS,
            };
        }
        else {
            // Failed
            pending.attempts++;
            saveState();
            options.logger.warn(`[access] ❌ PIN verification failed for ${mxid} (attempt ${pending.attempts})`);
            if (pending.attempts >= maxAttempts) {
                return {
                    allowed: false,
                    response: options.pinBlockedMessage || DEFAULT_PIN_BLOCKED,
                };
            }
            return {
                allowed: false,
                response: options.pinFailureMessage || DEFAULT_PIN_FAILURE,
            };
        }
    }
    // New user on allowlist - prompt for PIN
    state.pendingPin[mxid] = {
        promptedAt: Date.now(),
        attempts: 0,
    };
    saveState();
    options.logger.info(`[access] 🔐 Prompting ${mxid} for PIN`);
    return {
        allowed: false,
        response: options.pinPromptMessage || DEFAULT_PIN_PROMPT,
    };
}
/**
 * Mark a user as verified (for Krill App flow that uses ai.krill.pair.*)
 */
function markVerified(mxid, userId, email) {
    delete state.pendingPin[mxid];
    state.verified[mxid] = {
        verifiedAt: Date.now(),
        userId,
        email,
    };
    saveState();
    options?.logger.info(`[access] User ${mxid} marked as verified (via pairing)`);
}
/**
 * Revoke access for a user
 */
function revokeAccess(mxid) {
    delete state.verified[mxid];
    delete state.pendingPin[mxid];
    saveState();
    options?.logger.info(`[access] Access revoked for ${mxid}`);
}
/**
 * Get all verified users
 */
function getVerifiedUsers() {
    return Object.keys(state.verified);
}
