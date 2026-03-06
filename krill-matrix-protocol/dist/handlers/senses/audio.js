"use strict";
/**
 * Audio Sense Handler
 *
 * Processes ai.krill.sense.audio messages:
 *
 * Message kinds:
 *   - transcript_chunk: Periodic STT text from the app microphone
 *     → Appended to daily transcript file, NOT sent to agent
 *   - wake_word: Wake word detected (e.g. "Hey Kathy")
 *     → Builds context from recent transcript + query
 *     → Forwards to agent as a real message for response
 *   - config: Audio sense configuration update from app
 *     → Updates config.json (wake words, language, etc.)
 *   - session_start / session_end: Microphone on/off
 *     → Updates current-session.json
 *
 * File structure:
 *   <storagePath>/audio/
 *     current-session.json    ← mic state + config
 *     config.json             ← wake words, language, context window
 *     transcript-YYYY-MM-DD.md  ← daily transcript log
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAudio = handleAudio;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DEFAULT_CONTEXT_WINDOW = 60; // seconds
const MAX_DAILY_LINES = 5000;
const recentTranscript = [];
const MAX_BUFFER_ENTRIES = 200;
function getAudioDir(ctx) {
    const dir = path_1.default.join(ctx.config.storagePath, "audio");
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
function getSessionPath(ctx) {
    return path_1.default.join(getAudioDir(ctx), "current-session.json");
}
function getConfigPath(ctx) {
    return path_1.default.join(getAudioDir(ctx), "config.json");
}
function getDailyTranscriptPath(ctx) {
    const date = new Date().toISOString().split("T")[0];
    return path_1.default.join(getAudioDir(ctx), `transcript-${date}.md`);
}
function readJSON(filePath, fallback) {
    try {
        if (fs_1.default.existsSync(filePath)) {
            return JSON.parse(fs_1.default.readFileSync(filePath, "utf-8"));
        }
    }
    catch { /* ignore */ }
    return fallback;
}
function writeJSON(filePath, data) {
    fs_1.default.writeFileSync(filePath, JSON.stringify(data, null, 2));
}
/**
 * Add transcript text to the in-memory buffer
 */
function bufferTranscript(text, timestamp) {
    const ts = new Date(timestamp).getTime();
    recentTranscript.push({ text, timestamp: ts });
    // Trim buffer to max size
    while (recentTranscript.length > MAX_BUFFER_ENTRIES) {
        recentTranscript.shift();
    }
}
/**
 * Get recent transcript text within a time window
 */
function getRecentContext(windowSeconds) {
    const cutoff = Date.now() - windowSeconds * 1000;
    const relevant = recentTranscript
        .filter(e => e.timestamp >= cutoff)
        .map(e => e.text);
    return relevant.join(" ");
}
/**
 * Append text to the daily transcript markdown file
 */
function appendToDaily(ctx, text, timestamp) {
    const filePath = getDailyTranscriptPath(ctx);
    const time = new Date(timestamp).toLocaleTimeString("en-US", {
        hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    // Create file with header if new
    if (!fs_1.default.existsSync(filePath)) {
        const date = new Date().toISOString().split("T")[0];
        fs_1.default.writeFileSync(filePath, `# Audio Transcript — ${date}\n\n`);
    }
    // Check line count (rough)
    const maxLines = ctx.config.audio?.maxDailyLines ?? MAX_DAILY_LINES;
    try {
        const stats = fs_1.default.statSync(filePath);
        if (stats.size > maxLines * 80) { // rough estimate ~80 chars/line
            ctx.logger.warn(`[senses/audio] Daily transcript exceeds max size, skipping append`);
            return;
        }
    }
    catch { /* ignore */ }
    fs_1.default.appendFileSync(filePath, `[${time}] ${text}\n`);
}
/**
 * Handle transcript chunk — silent storage, no agent notification
 */
async function handleTranscriptChunk(ctx, chunk) {
    if (!chunk.text || chunk.text.trim().length === 0)
        return;
    const text = chunk.text.trim();
    const timestamp = chunk.endTime || new Date().toISOString();
    // Buffer for wake word context
    bufferTranscript(text, timestamp);
    // Append to daily file
    appendToDaily(ctx, text, timestamp);
    // Update session
    const session = readJSON(getSessionPath(ctx), { active: true });
    session.lastChunkAt = timestamp;
    session.language = chunk.language || session.language;
    writeJSON(getSessionPath(ctx), session);
    ctx.logger.debug(`[senses/audio] Chunk: "${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
}
/**
 * Handle wake word detection — THIS notifies the agent
 */
async function handleWakeWord(ctx, event) {
    ctx.logger.info(`[senses/audio] 🔔 Wake word "${event.wakeWord}" detected!`);
    const contextWindow = event.contextWindowSeconds
        ?? ctx.config.audio?.contextWindowSeconds
        ?? DEFAULT_CONTEXT_WINDOW;
    // Build context from recent transcript buffer
    const recentContext = event.recentTranscript || getRecentContext(contextWindow);
    const query = event.query?.trim();
    if (!query) {
        ctx.logger.warn(`[senses/audio] Wake word detected but no query provided`);
        return;
    }
    // Log wake event to daily transcript
    appendToDaily(ctx, `⚡ WAKE: "${event.wakeWord}" → "${query}"`, event.timestamp);
    // Build the message for the agent
    // This is the key part: we forward this as a REAL message to the agent
    let agentMessage = `🎤 **Voice Query** (via "${event.wakeWord}"):\n\n`;
    if (recentContext && recentContext.length > 0) {
        agentMessage += `> _Recent conversation context:_\n> "${recentContext}"\n\n`;
    }
    agentMessage += `**Question:** ${query}`;
    // Send to agent via reply (this goes through the normal message pipeline)
    await ctx.reply(agentMessage);
    ctx.logger.info(`[senses/audio] Forwarded voice query to agent: "${query.substring(0, 80)}"`);
}
/**
 * Handle audio config update from the app
 */
async function handleConfig(ctx, config) {
    const configPath = getConfigPath(ctx);
    const existing = readJSON(configPath, {});
    const updated = {
        ...existing,
        ...config,
        updatedAt: new Date().toISOString(),
    };
    writeJSON(configPath, updated);
    ctx.logger.info(`[senses/audio] Config updated: ${JSON.stringify(config)}`);
}
/**
 * Handle session start/end (microphone toggle)
 */
async function handleSession(ctx, kind, content) {
    const sessionPath = getSessionPath(ctx);
    if (kind === "session_start") {
        const session = {
            active: true,
            since: new Date().toISOString(),
            wakeWords: content.wakeWords,
            language: content.language,
        };
        writeJSON(sessionPath, session);
        appendToDaily(ctx, "--- 🎤 Microphone ON ---", new Date().toISOString());
        ctx.logger.info(`[senses/audio] Session started (wake words: ${(content.wakeWords || []).join(", ")})`);
    }
    else {
        const session = {
            active: false,
        };
        writeJSON(sessionPath, session);
        appendToDaily(ctx, "--- 🔇 Microphone OFF ---", new Date().toISOString());
        ctx.logger.info(`[senses/audio] Session ended`);
        // Clear buffer
        recentTranscript.length = 0;
    }
}
/**
 * Main audio sense handler
 */
async function handleAudio(ctx) {
    const content = ctx.content;
    const kind = content?.kind;
    if (!kind) {
        ctx.logger.warn(`[senses/audio] Missing 'kind' in audio sense message`);
        return;
    }
    switch (kind) {
        case "transcript_chunk":
            await handleTranscriptChunk(ctx, content);
            break;
        case "wake_word":
            await handleWakeWord(ctx, content);
            break;
        case "config":
            await handleConfig(ctx, content);
            break;
        case "session_start":
        case "session_end":
            await handleSession(ctx, kind, content);
            break;
        default:
            ctx.logger.warn(`[senses/audio] Unknown audio kind: ${kind}`);
    }
}
