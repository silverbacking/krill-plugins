"use strict";
/**
 * Microphone Sense Handler
 *
 * Processes ai.krill.sense.microphone messages (transcript file transfers):
 *
 * The Flutter app sends transcript text via custom Matrix events.
 * This handler reassembles multi-part transcripts, saves to disk,
 * uploads to Matrix as m.file, and cleans up.
 *
 * Event content:
 *   { sessionId, part, totalParts?, final, language?, fileName, transcript, duration? }
 *
 * File structure:
 *   <storagePath>/transcripts/
 *     <fileName>                          ← completed transcript files
 *     .pending/<sessionId>/part-N.txt     ← in-progress multi-part
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMicrophone = handleMicrophone;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/** Timeout for pending sessions: 30 minutes */
const PENDING_TIMEOUT_MS = 30 * 60 * 1000;
function ensureDir(dirPath) {
    if (!fs_1.default.existsSync(dirPath)) {
        fs_1.default.mkdirSync(dirPath, { recursive: true });
    }
}
function getTranscriptsDir(ctx) {
    return path_1.default.join(ctx.config.storagePath, "transcripts");
}
function getPendingDir(ctx) {
    return path_1.default.join(getTranscriptsDir(ctx), ".pending");
}
/**
 * Clean up expired pending sessions (>30 min old)
 */
function cleanupExpiredSessions(ctx) {
    const pendingDir = getPendingDir(ctx);
    if (!fs_1.default.existsSync(pendingDir))
        return;
    try {
        const sessions = fs_1.default.readdirSync(pendingDir);
        const now = Date.now();
        for (const sessionId of sessions) {
            const sessionDir = path_1.default.join(pendingDir, sessionId);
            const stat = fs_1.default.statSync(sessionDir);
            if (now - stat.mtimeMs > PENDING_TIMEOUT_MS) {
                fs_1.default.rmSync(sessionDir, { recursive: true, force: true });
                ctx.logger.info(`[senses/microphone] 🗑️ Expired pending session: ${sessionId}`);
            }
        }
    }
    catch (e) {
        ctx.logger.debug(`[senses/microphone] Cleanup error (non-fatal): ${e}`);
    }
}
/**
 * Main microphone handler
 */
async function handleMicrophone(ctx) {
    const event = ctx.content;
    if (!event.sessionId || !event.fileName || event.transcript === undefined) {
        ctx.logger.warn("[senses/microphone] Invalid event — missing sessionId, fileName, or transcript");
        return;
    }
    ctx.logger.info(`[senses/microphone] Part ${event.part}, final=${event.final}, session=${event.sessionId.substring(0, 8)}…, file=${event.fileName}`);
    // Periodic cleanup of expired sessions
    cleanupExpiredSessions(ctx);
    // Simple case: single part, final
    if (event.part === 1 && event.final) {
        await saveAndUpload(ctx, event.transcript, event);
        return;
    }
    // Multi-part: save this part
    const sessionDir = path_1.default.join(getPendingDir(ctx), event.sessionId);
    ensureDir(sessionDir);
    const partFile = path_1.default.join(sessionDir, `part-${event.part}.txt`);
    fs_1.default.writeFileSync(partFile, event.transcript);
    ctx.logger.debug(`[senses/microphone] Saved part ${event.part} to ${partFile}`);
    if (!event.final) {
        return; // Wait for more parts
    }
    // Final part received — concatenate all parts
    const partFiles = fs_1.default.readdirSync(sessionDir)
        .filter(f => f.startsWith("part-") && f.endsWith(".txt"))
        .sort((a, b) => {
        const numA = parseInt(a.replace("part-", "").replace(".txt", ""));
        const numB = parseInt(b.replace("part-", "").replace(".txt", ""));
        return numA - numB;
    });
    const fullTranscript = partFiles
        .map(f => fs_1.default.readFileSync(path_1.default.join(sessionDir, f), "utf-8"))
        .join("");
    await saveAndUpload(ctx, fullTranscript, event);
    // Clean up pending session
    fs_1.default.rmSync(sessionDir, { recursive: true, force: true });
    ctx.logger.debug(`[senses/microphone] Cleaned up pending session: ${event.sessionId}`);
}
/**
 * Save transcript to disk and upload to Matrix as m.file
 */
async function saveAndUpload(ctx, transcript, event) {
    const transcriptsDir = getTranscriptsDir(ctx);
    ensureDir(transcriptsDir);
    // Save to disk
    const filePath = path_1.default.join(transcriptsDir, event.fileName);
    fs_1.default.writeFileSync(filePath, transcript);
    ctx.logger.info(`[senses/microphone] 💾 Saved transcript: ${filePath} (${transcript.length} bytes)`);
    // Upload to Matrix
    const client = ctx.matrixClient;
    if (!client) {
        ctx.logger.warn("[senses/microphone] No matrixClient available — skipping Matrix upload");
        return;
    }
    try {
        const buffer = Buffer.from(transcript, "utf-8");
        // Upload content to Matrix
        const uploadResponse = await client.uploadContent(buffer, {
            name: event.fileName,
            type: "text/plain",
        });
        // Extract mxc URI — sdk-bot-api returns string or { content_uri }
        const mxcUri = typeof uploadResponse === "string"
            ? uploadResponse
            : uploadResponse?.content_uri || uploadResponse?.contentUri;
        if (!mxcUri) {
            ctx.logger.error(`[senses/microphone] Upload returned no mxc URI: ${JSON.stringify(uploadResponse)}`);
            return;
        }
        // Send m.file event to the room
        const fileEvent = {
            msgtype: "m.file",
            body: event.fileName,
            filename: event.fileName,
            info: {
                mimetype: "text/plain",
                size: buffer.length,
            },
            url: mxcUri,
        };
        await client.sendMessage(ctx.roomId, fileEvent);
        ctx.logger.info(`[senses/microphone] 📤 Uploaded to Matrix: ${event.fileName} → ${mxcUri}`);
    }
    catch (e) {
        ctx.logger.error(`[senses/microphone] Matrix upload failed: ${e.message || e}`);
    }
}
