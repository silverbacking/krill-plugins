import type { MatrixClient } from "matrix-bot-sdk";
import type { PluginRuntime } from "clawdbot/plugin-sdk";

import type { MatrixAuth } from "../client.js";
import type { MatrixRawEvent } from "./types.js";
import { EventType } from "./types.js";

export function registerMatrixMonitorEvents(params: {
  client: MatrixClient;
  auth: MatrixAuth;
  logVerboseMessage: (message: string) => void;
  warnedEncryptedRooms: Set<string>;
  warnedCryptoMissingRooms: Set<string>;
  logger: { warn: (meta: Record<string, unknown>, message: string) => void };
  formatNativeDependencyHint: PluginRuntime["system"]["formatNativeDependencyHint"];
  onRoomMessage: (roomId: string, event: MatrixRawEvent) => void | Promise<void>;
}): void {
  const {
    client,
    auth,
    logVerboseMessage,
    warnedEncryptedRooms,
    warnedCryptoMissingRooms,
    logger,
    formatNativeDependencyHint,
    onRoomMessage,
  } = params;

  client.on("room.message", onRoomMessage);

  client.on("room.encrypted_event", (roomId: string, event: MatrixRawEvent) => {
    const eventId = event?.event_id ?? "unknown";
    const eventType = event?.type ?? "unknown";
    logVerboseMessage(`matrix: encrypted event room=${roomId} type=${eventType} id=${eventId}`);
  });

  client.on("room.decrypted_event", (roomId: string, event: MatrixRawEvent) => {
    const eventId = event?.event_id ?? "unknown";
    const eventType = event?.type ?? "unknown";
    logVerboseMessage(`matrix: decrypted event room=${roomId} type=${eventType} id=${eventId}`);
  });

  client.on(
    "room.failed_decryption",
    async (roomId: string, event: MatrixRawEvent, error: Error) => {
      logger.warn(
        { roomId, eventId: event.event_id, error: error.message },
        "Failed to decrypt message",
      );
      logVerboseMessage(
        `matrix: failed decrypt room=${roomId} id=${event.event_id ?? "unknown"} error=${error.message}`,
      );
    },
  );

  client.on("room.invite", (roomId: string, event: MatrixRawEvent) => {
    const eventId = event?.event_id ?? "unknown";
    const sender = event?.sender ?? "unknown";
    const isDirect = (event?.content as { is_direct?: boolean } | undefined)?.is_direct === true;
    logVerboseMessage(
      `matrix: invite room=${roomId} sender=${sender} direct=${String(isDirect)} id=${eventId}`,
    );
  });

  client.on("room.join", (roomId: string, event: MatrixRawEvent) => {
    const eventId = event?.event_id ?? "unknown";
    logVerboseMessage(`matrix: join room=${roomId} id=${eventId}`);
  });

  client.on("room.event", async (roomId: string, event: MatrixRawEvent) => {
    const eventType = event?.type ?? "unknown";
    
    // === KRILL PAIRING COMPLETE HANDLER ===
    if (eventType === "ai.krill.pair.complete") {
      const senderId = event?.sender ?? "unknown";
      const selfUserId = await client.getUserId();
      
      // Don't process our own events
      if (senderId === selfUserId) return;
      
      logVerboseMessage(`matrix: krill pairing complete from ${senderId} in ${roomId}`);
      
      try {
        // Fetch user profile
        let displayName = senderId.split(":")[0].replace("@", "");
        try {
          const profile = await client.getUserProfile(senderId);
          displayName = profile?.displayname || displayName;
        } catch {}
        
        const content = event?.content as { 
          user_id?: string; 
          platform?: string;
          paired_at?: string;
        } | undefined;
        
        // Send welcome notification as a message to the room
        const welcomeMessage = `🦐 **New Krill Connection!**

**${displayName}** just paired with you via Krill App.

• **User ID:** ${senderId}
• **Platform:** ${content?.platform || "unknown"}
• **Time:** ${new Date().toLocaleString()}

Say hello and introduce yourself! 👋`;

        await client.sendMessage(roomId, {
          msgtype: "m.text",
          body: welcomeMessage,
        });
        
        logVerboseMessage(`matrix: sent krill welcome to ${roomId}`);
      } catch (err) {
        logger.warn({ roomId, error: String(err) }, "Failed to handle krill pairing");
      }
      return;
    }
    // === END KRILL PAIRING HANDLER ===
    
    if (eventType === EventType.RoomMessageEncrypted) {
      logVerboseMessage(
        `matrix: encrypted raw event room=${roomId} id=${event?.event_id ?? "unknown"}`,
      );
      if (auth.encryption !== true && !warnedEncryptedRooms.has(roomId)) {
        warnedEncryptedRooms.add(roomId);
        const warning =
          "matrix: encrypted event received without encryption enabled; set channels.matrix.encryption=true and verify the device to decrypt";
        logger.warn({ roomId }, warning);
      }
      if (auth.encryption === true && !client.crypto && !warnedCryptoMissingRooms.has(roomId)) {
        warnedCryptoMissingRooms.add(roomId);
        const hint = formatNativeDependencyHint({
          packageName: "@matrix-org/matrix-sdk-crypto-nodejs",
          manager: "pnpm",
          downloadCommand:
            "node node_modules/@matrix-org/matrix-sdk-crypto-nodejs/download-lib.js",
        });
        const warning = `matrix: encryption enabled but crypto is unavailable; ${hint}`;
        logger.warn({ roomId }, warning);
      }
      return;
    }
    if (eventType === EventType.RoomMember) {
      const membership = (event?.content as { membership?: string } | undefined)?.membership;
      const stateKey = (event as { state_key?: string }).state_key ?? "";
      logVerboseMessage(
        `matrix: member event room=${roomId} stateKey=${stateKey} membership=${membership ?? "unknown"}`,
      );
    }
  });
}
