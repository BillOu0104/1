import type { EndReason } from '../physics/detection';
export interface SimulationEvent {
  id: number;
  type: 'started' | 'ended' | 'reset' | 'warning';
  seed: string;
  years: number;
  message: string;
}
export interface AppEvents {
  simulation: SimulationEvent;
  termination: EndReason;
  visibility: boolean;
  notification: { title: string; body: string };
}
export class EventBus<Events extends object> {
  private listeners = new Map<keyof Events, Set<(payload: never) => void>>();
  on<K extends keyof Events>(type: K, listener: (payload: Events[K]) => void): () => void {
    const handlers = this.listeners.get(type) ?? new Set();
    handlers.add(listener as (payload: never) => void);
    this.listeners.set(type, handlers);
    return () => {
      handlers.delete(listener as (payload: never) => void);
    };
  }
  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    this.listeners.get(type)?.forEach((listener) => listener(payload as never));
  }
}
