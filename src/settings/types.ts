import type { GeneratorMode, Vec3 } from '../physics/types';
export interface AppSettings {
  massA: number;
  massB: number;
  massC: number;
  paused: boolean;
  speed: number;
  seed: string;
  autoRestart: boolean;
  trails: boolean;
  trailLengthYears: number;
}
/** Optional future modules own these configs and their validation/migrations. Not active controls. */
export interface FutureFeatureConfig {
  quick: { language: string; theme: string; background: string };
  physics: {
    masses: number[];
    gravitationalConstant: number;
    timeStep: number;
    integrator: 'dopri5-adaptive' | 'velocity-verlet' | 'yoshida4';
    softening: number;
    constraints: boolean;
    escapeDistance: number;
  };
  initial: {
    mode: GeneratorMode;
    bodies?: { position: Vec3; velocity: Vec3 }[];
    screeningDuration?: number;
  };
  camera: { autoFollow: boolean; distance: number; sensitivity: number; rotation: Vec3 };
  orbit: { radiusScale: number; colors: string[]; glow: number; trailLength: number };
  background: { stars: boolean; nebula: boolean; customUrl?: string };
  dust: { count: number; size: number; density: number };
  postProcessing: { hdr: boolean; blur: number; bloom: number };
  temperature: { albedo: number; emissivity: number };
  civilization: { enabled: boolean; model: string };
  civilizationLog: { limit: number; ranking: boolean };
  widgets: { clock: boolean; opacity: number; layout: 'wide' | 'compact' };
  audio: { enabled: boolean; gain: number };
  notifications: { inApp: boolean; desktop: boolean };
  wallpaper: { pauseWhenHidden: boolean; propertyMapping: Record<string, string> };
  loading: { restartDelay: number; showStatus: boolean };
}
