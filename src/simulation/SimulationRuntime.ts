import { SimulationEngine, type SimulationSnapshot } from './SimulationEngine';
import type { SettingsStore } from '../settings/SettingsStore';
import type { SceneRenderer } from '../rendering/SceneRenderer';
/** Browser scheduling and view subscriptions stay outside the numerical core. */
export class SimulationRuntime {
  readonly engine: SimulationEngine;
  private current: SimulationSnapshot;
  private listeners = new Set<() => void>();
  private hostPaused = false;
  constructor(readonly settings: SettingsStore) {
    const config = settings.getSnapshot();
    this.engine = new SimulationEngine(config.seed);
    this.engine.setControls(config);
    this.current = this.engine.snapshot();
  }
  getSnapshot = (): SimulationSnapshot => this.current;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  publish = (): void => {
    this.current = this.engine.snapshot();
    this.listeners.forEach((listener) => listener());
  };
  reset = (): void => {
    this.engine.reset(this.settings.getSnapshot().seed);
    this.publish();
  };
  /** Future Wallpaper host lifecycle entry point. Hidden time is never accumulated. */
  setHostPaused(paused: boolean): void {
    this.hostPaused = paused;
  }
  attach(renderer: SceneRenderer): () => void {
    let frameId = 0,
      previous: number | null = null,
      lastPublished = 0,
      active = true;
    const syncSettings = () => {
      this.engine.setControls(this.settings.getSnapshot());
      this.publish();
    };
    const unsubscribe = this.settings.subscribe(syncSettings);
    syncSettings();
    const tick = (now: number) => {
      if (!active || document.hidden) return;
      const elapsed = previous === null ? 0 : Math.max(0, (now - previous) / 1000);
      previous = now;
      if (!this.hostPaused) this.engine.advance(elapsed);
      renderer.render(
        this.engine.getBodies(),
        this.engine.getGeneration(),
        this.engine.getTime(),
        this.settings.getSnapshot().trails,
        Math.min(elapsed, 0.1),
      );
      if (now - lastPublished >= 100) {
        this.publish();
        lastPublished = now;
      }
      frameId = requestAnimationFrame(tick);
    };
    const visibility = () => {
      cancelAnimationFrame(frameId);
      previous = null;
      this.engine.events.emit('visibility', !document.hidden);
      if (!document.hidden) frameId = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', visibility);
    visibility();
    return () => {
      active = false;
      cancelAnimationFrame(frameId);
      document.removeEventListener('visibilitychange', visibility);
      unsubscribe();
    };
  }
}
