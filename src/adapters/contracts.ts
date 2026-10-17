import type { AppSettings } from '../settings/types';
/** Host-specific mapping is explicit. Do not install a global Wallpaper Engine listener in V0.1. */
export interface WallpaperHostAdapter {
  connect(handlers: {
    onProperties: (settings: Partial<AppSettings>) => void;
    onPause: (paused: boolean) => void;
  }): () => void;
}
/** Desktop notifications require a separate native host capability; Web wallpaper alone is not sufficient. */
export interface NotificationHostAdapter {
  readonly supported: boolean;
  notify(message: { title: string; body: string }): Promise<void>;
}
export interface AudioFrame {
  samples: Float32Array;
  sampleRate: number;
  timestamp: number;
}
export interface AudioSourceAdapter {
  connect(onFrame: (frame: AudioFrame) => void): Promise<() => void>;
}
export interface TemperatureEstimate {
  kelvin: number;
  habitable: boolean;
  model: string;
}
export interface CivilizationState {
  era: 'stable' | 'chaotic';
  stage: string;
  events: { year: number; message: string }[];
}
