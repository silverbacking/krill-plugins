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
import type { SenseContext } from "./types.js";
/**
 * Main microphone handler
 */
export declare function handleMicrophone(ctx: SenseContext): Promise<void>;
