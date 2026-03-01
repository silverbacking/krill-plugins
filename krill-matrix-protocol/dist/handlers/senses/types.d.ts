/**
 * Shared types for sense handlers
 */
export interface SenseContext {
    type: string;
    content: any;
    senderId: string;
    roomId: string;
    reply: (text: string) => Promise<void>;
    logger: {
        info: (msg: string) => void;
        warn: (msg: string) => void;
        debug: (msg: string) => void;
        error: (msg: string) => void;
    };
    config: SensesConfig;
}
export interface SensesConfig {
    /** Base directory for sense data files (e.g., ~/jarvisx/state/location/) */
    storagePath: string;
    location?: LocationConfig;
    audio?: AudioConfig;
    /** Matrix homeserver URL for media downloads (e.g., https://matrix.krillbot.network) */
    homeserverUrl?: string;
    /** Matrix access token for authenticated media downloads */
    accessToken?: string;
}
export interface AudioConfig {
    /** Context window in seconds to include when wake word fires (default: 60) */
    contextWindowSeconds?: number;
    /** Max transcript lines per daily file before rotation (default: 5000) */
    maxDailyLines?: number;
}
export interface TranscriptChunk {
    text: string;
    language?: string;
    startTime: string;
    endTime: string;
    confidence?: number;
    isFinal: boolean;
}
export interface WakeWordEvent {
    wakeWord: string;
    query: string;
    recentTranscript?: string;
    contextWindowSeconds?: number;
    timestamp: string;
}
export interface AudioSession {
    active: boolean;
    since?: string;
    lastChunkAt?: string;
    wakeWords?: string[];
    language?: string;
}
export interface LocationConfig {
    /** Minimum distance in meters to consider "significant movement" (default: 50) */
    movementThresholdMeters?: number;
    /** Path to geofences.json (default: <storagePath>/geofences.json) */
    geofencesPath?: string;
}
export interface LocationPoint {
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number;
    speed?: number;
    heading?: number;
    timestamp: string;
}
export interface CurrentLocation {
    current: LocationPoint;
    geofence?: string;
    placeName?: string;
    updatedAt: string;
}
export interface Geofence {
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
}
export interface GeofenceState {
    [geofenceId: string]: {
        inside: boolean;
        since?: string;
    };
}
