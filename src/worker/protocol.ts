import type { TrailBatch } from '../physics/trajectory';
import type {
  SimulationControls,
  SimulationSnapshot,
  SessionHistory,
} from '../simulation/SimulationEngine';
export type PhysicsRequest =
  | {
      type: 'init';
      seed: string;
      masses: number[];
      controls: SimulationControls;
      session?: SessionHistory;
    }
  | { type: 'reset'; seed: string; masses: number[] }
  | { type: 'controls'; controls: SimulationControls }
  | { type: 'tick'; elapsed: number; sequence: number }
  | { type: 'visibility'; active: boolean };
export type PhysicsResponse =
  | {
      type: 'snapshot';
      snapshot: SimulationSnapshot;
      sequence?: number;
      workerCpuMs: number;
      eventsUnchanged?: boolean;
      trails?: TrailBatch;
    }
  | { type: 'error'; message: string };
export interface PhysicsPort {
  postMessage(message: PhysicsRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<PhysicsResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
