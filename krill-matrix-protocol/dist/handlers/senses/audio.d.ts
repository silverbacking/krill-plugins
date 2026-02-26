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
import type { SenseContext } from "./types.js";
/**
 * Main audio sense handler
 */
export declare function handleAudio(ctx: SenseContext): Promise<void>;
