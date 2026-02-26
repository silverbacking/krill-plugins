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
  timestamp: string; // ISO 8601
}

export interface CurrentLocation {
  current: LocationPoint;
  geofence?: string; // Name of current geofence, if any
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
