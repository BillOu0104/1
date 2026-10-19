import type { V04Settings } from '../environment/config';
import type { GravityCageConfig } from '../physics/cage';
import type { SeedMode } from '../simulation/seeds';
import type { TrailBatch } from '../physics/trajectory';
import type {
  SimulationControls,
  SimulationSnapshot,
  SessionHistory,
} from '../simulation/SimulationEngine';
export type PhysicsRequest =
  | {
      type: 'init';
      environment?: V04Settings;
      seed: string;
      seedMode?: SeedMode;
      masses: number[];
      controls: SimulationControls;
      galaxyScale?: number;
      cage?: GravityCageConfig;
      session?: SessionHistory;
    }
  | {
      type: 'reset';
      environment?: V04Settings;
      seed: string;
      seedMode?: SeedMode;
      controls?: SimulationControls;
      masses: number[];
      galaxyScale?: number;
    }
  | { type: 'configure'; galaxyScale: number; cage: GravityCageConfig; environment?: V04Settings }
  | { type: 'controls'; controls: SimulationControls }
  | { type: 'tick'; elapsed: number; wallElapsed?: number; sequence: number }
  | { type: 'visibility'; active: boolean };
export type PhysicsResponse =
  | {
      type: 'snapshot';
      snapshot: SimulationSnapshot;
      sequence?: number;
      workerCpuMs: number;
      eventsUnchanged?: boolean;
      environmentHistoryUnchanged?: boolean;
      trails?: TrailBatch;
    }
  | { type: 'error'; message: string };
export interface PhysicsPort {
  postMessage(message: PhysicsRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<PhysicsResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
