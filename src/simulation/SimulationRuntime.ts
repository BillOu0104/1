import { interruptCivilization } from '../environment/interrupted';
import { cageFromSettings } from '../settings/physicsSettings';
import {
  SimulationEngine,
  newRunStatistics,
  type SimulationSnapshot,
  type SessionHistory,
} from './SimulationEngine';
import type { SettingsStore } from '../settings/SettingsStore';
import type { SceneRenderer } from '../rendering/SceneRenderer';
import type { PhysicsPort, PhysicsRequest, PhysicsResponse } from '../worker/protocol';
import { OriginalRandomInitializer } from '../physics/originalInitializer';
import { v04FromSettings, evolutionInputs } from '../environment/config';
import type { AppSettings } from '../settings/types';
import { createRandomSeed, nextRoundSeed } from './seeds';
import { controlsFromSettings } from '../settings/simulationSettings';
export interface RuntimeOptions {
  workerFactory?: () => PhysicsPort;
  synchronous?: boolean;
}
/** The production RAF never advances physics: authoritative state lives in a module Worker. */
export class SimulationRuntime {
  readonly engine: SimulationEngine; // lightweight bootstrap + explicit synchronous test adapter only
  private current: SimulationSnapshot;
  private uiSnapshot: SimulationSnapshot;
  private lastUiPublish = 0;
  private epoch = 0;
  private previous: SimulationSnapshot | null = null;
  private receivedAt = 0;
  private listeners = new Set<() => void>();
  private hostPaused = false;
  private port: PhysicsPort | null = null;
  private inFlight = false;
  private queuedTime = 0;
  private queuedWallTime = 0;
  private sequence = 0;
  private lastSequence = 0;
  private faultTimes: number[] = [];
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attached = false;
  private workerCpuMs = 0;
  private workerLatencyMs = 0;
  private sentAt = 0;
  private renderer: SceneRenderer | null = null;
  private sentPhysicsSignature = '';
  private activeMasses: number[] = [];
  constructor(
    readonly settings: SettingsStore,
    private readonly options: RuntimeOptions = {},
  ) {
    const config = settings.getSnapshot();
    this.activeMasses = this.masses();
    const seed = config.seedMode === 'random' ? createRandomSeed() : config.seed;
    const engineOptions = {
      seedMode: config.seedMode,
      generator: new OriginalRandomInitializer(this.masses(), v04FromSettings(config)),
      environment: v04FromSettings(config),
      config: { galaxyScale: config.galaxyScale, cage: cageFromSettings(config) },
    };
    try {
      this.engine = new SimulationEngine(seed, engineOptions);
    } catch (error) {
      // Keep settings accessible after a persisted Custom Seed with overlapping bodies.
      this.engine = new SimulationEngine(seed, { ...engineOptions, initialBodies: [] });
      this.engine.warn(error instanceof Error ? error.message : '初始条件无效');
    }
    this.engine.setControls(controlsFromSettings(config));
    this.current = this.engine.snapshot();
    this.current.initialization = {
      referenceMasses: [...this.activeMasses],
      environment: v04FromSettings(config),
      galaxyScale: config.galaxyScale,
    };
    this.uiSnapshot = this.current;
  }
  private masses(): number[] {
    const s = this.settings.getSnapshot();
    return [s.massA, s.massB, s.massC];
  }
  getSnapshot = (): SimulationSnapshot => this.uiSnapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  publish = (): void => {
    if (this.options.synchronous) {
      this.current = this.engine.snapshot();
      this.current.initialization = {
        referenceMasses: [...this.activeMasses],
        environment: this.current.initialization?.environment,
        galaxyScale: this.engine.config.galaxyScale ?? 1,
      };
    }
    this.uiSnapshot = this.current;
    this.lastUiPublish = performance.now();
    this.listeners.forEach((listener) => listener());
  };
  reset = (): void => {
    const settings = this.settings.getSnapshot();
    this.startMatch(settings.seedMode === 'random' ? createRandomSeed() : settings.seed);
  };
  rerunCurrentSeed = (): void => {
    const initialization = this.current.initialization;
    if (initialization) {
      if (initialization.environment) {
        for (const [key, value] of Object.entries(evolutionInputs(initialization.environment)))
          this.settings.set(key as keyof AppSettings, value);
      }
      this.settings.set('galaxyScale', initialization.galaxyScale);
      for (const [i, key] of ['massA', 'massB', 'massC'].entries())
        this.settings.set(key as 'massA' | 'massB' | 'massC', initialization.referenceMasses[i]!);
    }
    this.settings.set('seedMode', 'fixed');
    this.settings.set('seed', this.current.seed);
    this.startMatch(this.current.seed);
  };
  private startMatch(seed: string): void {
    this.activeMasses = this.masses();
    this.faultTimes = [];
    if (this.retry !== null) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    const settings = this.settings.getSnapshot();
    if (this.options.synchronous) {
      this.engine.setGalaxyScale(this.settings.getSnapshot().galaxyScale);
      this.engine.setControls(controlsFromSettings(settings));
      this.engine.environment.configure(v04FromSettings(settings), settings.cageEnabled);
      try {
        const bodies = new OriginalRandomInitializer(
          this.masses(),
          v04FromSettings(settings),
        ).generate(seed, this.engine.config);
        this.engine.reset(seed, bodies, settings.seedMode);
      } catch (error) {
        this.engine.reset(seed, [], settings.seedMode);
        this.engine.warn(error instanceof Error ? error.message : '初始条件无效');
      }
      this.current.initialization = {
        referenceMasses: [...this.activeMasses],
        galaxyScale: settings.galaxyScale,
        environment: v04FromSettings(settings),
      };
      this.publish();
      return;
    }
    this.current = {
      ...this.current,
      phase: 'initializing',
      seed,
      time: 0,
      years: 0,
      reason: null,
      steps: 0,
      controls: controlsFromSettings(settings),
      run: newRunStatistics(seed, settings.seedMode),
      restartLimitReached:
        settings.seedMode === 'fixed' && !settings.unlimitedRestarts && settings.maxRestarts === 0,
      autoRestartBlocked: false,
    };
    this.publish();
    if (this.port)
      this.send({
        type: 'reset',
        environment: v04FromSettings(settings),
        seed,
        controls: controlsFromSettings(settings),
        seedMode: settings.seedMode,
        masses: this.masses(),
        galaxyScale: this.settings.getSnapshot().galaxyScale,
      });
    else if (this.attached) {
      this.current = { ...this.current, restartCount: this.current.restartCount + 1 };
      this.startWorker(seed, this.session());
    }
  }
  private session(): SessionHistory {
    return {
      environment: this.current.environment
        ? {
            ranking: this.current.environment.sessionRanking,
            total: this.current.environment.sessionCivilizations,
          }
        : undefined,
      events: this.current.events,
      restartCount: this.current.restartCount,
      generation: this.current.generation,
      run: this.current.run,
    };
  }
  setHostPaused(paused: boolean): void {
    this.hostPaused = paused;
    this.queuedTime = 0;
    this.queuedWallTime = 0;
    this.send({ type: 'visibility', active: !paused && !document.hidden });
    if (!paused) this.scheduleRecovery();
  }
  private send(message: PhysicsRequest): void {
    this.port?.postMessage(message);
  }
  private startWorker(seed: string, session?: SessionHistory): void {
    // A failed worker construction still consumes this attempted round and its Seed.
    this.current = { ...this.current, seed, time: 0, years: 0, reason: null, steps: 0 };
    const epoch = ++this.epoch;
    this.port?.terminate();
    this.port = null;
    this.inFlight = false;
    this.queuedTime = 0;
    this.queuedWallTime = 0;
    this.lastSequence = 0;
    try {
      this.port =
        this.options.workerFactory?.() ??
        new Worker(new URL('../worker/physics.worker.ts', import.meta.url), { type: 'module' });
      this.port.onmessage = (event) => {
        if (epoch === this.epoch) this.receive(event.data);
      };
      this.port.onerror = (event) => {
        event.preventDefault?.();
        if (epoch === this.epoch) this.failed('物理 Worker 异常，已停止本轮');
      };
      this.current = { ...this.current, phase: 'initializing' };
      this.publish();
      this.send({
        type: 'init',
        environment: v04FromSettings(this.settings.getSnapshot()),
        seed,
        seedMode: this.current.run.seedMode,
        masses: this.masses(),
        controls: controlsFromSettings(this.settings.getSnapshot(), this.current.run.seedMode),
        galaxyScale: this.settings.getSnapshot().galaxyScale,
        cage: cageFromSettings(this.settings.getSnapshot()),
        session,
      });
      this.sentPhysicsSignature = JSON.stringify([
        this.settings.getSnapshot().galaxyScale,
        cageFromSettings(this.settings.getSnapshot()),
        v04FromSettings(this.settings.getSnapshot()),
      ]);
      this.send({ type: 'visibility', active: !this.hostPaused && !document.hidden });
    } catch {
      this.failed('浏览器无法启动物理 Worker，请检查浏览器支持或重试');
    }
  }
  private receive(message: PhysicsResponse): void {
    if (message.type === 'error') {
      this.failed(message.message);
      return;
    }
    if (message.sequence !== undefined) {
      if (message.sequence < this.lastSequence) return;
      this.lastSequence = message.sequence;
      this.inFlight = false;
      this.workerLatencyMs = performance.now() - this.sentAt;
    }
    this.previous = this.current;
    if (message.eventsUnchanged) message.snapshot.events = this.current.events;
    if (
      message.environmentHistoryUnchanged &&
      message.snapshot.environment &&
      this.current.environment
    ) {
      const old = this.current.environment;
      message.snapshot.environment = {
        ...message.snapshot.environment,
        events: old.events,
        records: old.records,
        eras: old.eras,
        ranking: old.ranking,
        sessionRanking: old.sessionRanking,
      };
    }
    this.current = message.snapshot;
    if (message.trails) this.renderer?.appendTrails?.(message.trails, message.snapshot.bodies);
    this.receivedAt = performance.now();
    this.workerCpuMs = message.workerCpuMs;
    if (
      performance.now() - this.lastUiPublish >= 100 ||
      this.current.phase !== this.uiSnapshot.phase ||
      this.current.generation !== this.uiSnapshot.generation ||
      this.current.events[0]?.id !== this.uiSnapshot.events[0]?.id ||
      this.current.restartLimitReached !== this.uiSnapshot.restartLimitReached
    )
      this.publish();
  }
  private failed(message: string): void {
    this.epoch++;
    this.port?.terminate();
    this.port = null;
    this.inFlight = false;
    this.queuedTime = 0;
    this.queuedWallTime = 0;
    const now = Date.now();
    this.faultTimes = this.faultTimes.filter((t) => now - t < 30000);
    this.faultTimes.push(now);
    const blocked = this.faultTimes.length >= 3;
    const reason = { type: 'numerical' as const, message, bodyIds: [], year: this.current.years };
    const run = { ...this.current.run, lastEndReason: reason };
    if (this.current.years > run.longestYears) {
      run.longestYears = this.current.years;
      run.longestSeed = this.current.seed;
    }
    this.current = {
      ...this.current,
      phase: 'ended',
      environment: this.current.environment
        ? interruptCivilization(this.current.environment, message)
        : undefined,
      reason,
      run,
      restartLimitReached: this.limitReached(),
      autoRestartBlocked: blocked,
      events: [
        {
          id: Math.max(0, ...this.current.events.map((e) => e.id)) + 1,
          type: 'ended' as const,
          seed: this.current.seed,
          years: this.current.years,
          message,
          reason,
        },
        ...this.current.events,
      ].slice(0, 200),
    };
    this.publish();
    this.scheduleRecovery();
  }
  private limitReached(): boolean {
    const limit = controlsFromSettings(
      this.settings.getSnapshot(),
      this.current.run.seedMode,
    ).maxRestarts;
    return limit != null && this.current.run.autoRestarts >= limit;
  }
  private scheduleRecovery(): void {
    if (
      !this.port &&
      this.retry === null &&
      this.current.phase === 'ended' &&
      !this.current.autoRestartBlocked &&
      !this.limitReached() &&
      this.settings.getSnapshot().autoRestart &&
      !this.settings.getSnapshot().paused &&
      this.attached
    ) {
      this.retry = setTimeout(() => {
        this.retry = null;
        if (!this.attached) return;
        if (
          document.hidden ||
          this.hostPaused ||
          this.settings.getSnapshot().paused ||
          !this.settings.getSnapshot().autoRestart ||
          this.limitReached()
        )
          return;
        const seed = nextRoundSeed(this.current.seed, this.current.run.seedMode);
        this.current = {
          ...this.current,
          restartCount: this.current.restartCount + 1,
          run: {
            ...this.current.run,
            autoRestarts: this.current.run.autoRestarts + 1,
            round: this.current.run.round + 1,
          },
        };
        this.startWorker(seed, this.session());
      }, 2000);
    }
  }
  attach(renderer: SceneRenderer): () => void {
    let frameId = 0,
      previous: number | null = null,
      lastPublished = 0,
      lastRendered = 0;
    this.attached = true;
    this.renderer = renderer;
    if (!this.options.synchronous) this.startWorker(this.current.seed, this.session());
    const syncSettings = () => {
      const settings = this.settings.getSnapshot();
      if (this.options.synchronous) {
        this.engine.setControls(controlsFromSettings(settings, this.current.run.seedMode));
        this.engine.setCage(cageFromSettings(settings));
        this.engine.environment.configure(v04FromSettings(settings), settings.cageEnabled);
      } else {
        this.current = {
          ...this.current,
          controls: controlsFromSettings(settings, this.current.run.seedMode),
          restartLimitReached: this.limitReached(),
        };
        this.send({
          type: 'controls',
          controls: controlsFromSettings(settings, this.current.run.seedMode),
        });
        const cage = cageFromSettings(settings),
          signature = JSON.stringify([settings.galaxyScale, cage, v04FromSettings(settings)]);
        if (signature !== this.sentPhysicsSignature) {
          this.send({
            type: 'configure',
            galaxyScale: settings.galaxyScale,
            cage,
            environment: v04FromSettings(settings),
          });
          this.sentPhysicsSignature = signature;
        }
      }
      this.queuedTime = 0;
      this.queuedWallTime = 0;
      this.publish();
      this.scheduleRecovery();
    };
    const unsubscribe = this.settings.subscribe(syncSettings);
    syncSettings();
    const tick = (now: number) => {
      if (!this.attached || document.hidden) return;
      const elapsed = previous === null ? 0 : Math.max(0, (now - previous) / 1000);
      previous = now;
      if (this.options.synchronous) {
        if (!this.hostPaused) this.engine.advance(elapsed);
      } else if (!this.hostPaused && !this.settings.getSnapshot().paused) {
        this.queuedTime = Math.min(0.25, this.queuedTime + elapsed);
        this.queuedWallTime += elapsed;
        if (!this.inFlight && this.queuedTime >= 1 / 30) {
          this.inFlight = true;
          this.sentAt = performance.now();
          this.send({
            type: 'tick',
            elapsed: this.queuedTime,
            wallElapsed: this.queuedWallTime,
            sequence: ++this.sequence,
          });
          this.queuedTime = 0;
          this.queuedWallTime = 0;
        }
      }
      const interval =
        this.workerCpuMs > 5 || this.workerLatencyMs > 70
          ? 1000 / 20
          : (renderer.getFrameInterval?.() ?? 1000 / 30);
      if (now - lastRendered >= interval - 1) {
        const snapshot = this.options.synchronous ? this.engine.snapshot() : this.current;
        let bodies = snapshot.bodies;
        let displayTime = snapshot.time;
        if (
          this.previous &&
          this.previous.generation === snapshot.generation &&
          snapshot.phase === 'running' &&
          !snapshot.controls.paused
        ) {
          const alpha = Math.max(
            0,
            Math.min(1, (performance.now() - this.receivedAt) / (1000 / 30)),
          );
          displayTime = this.previous.time * (1 - alpha) + snapshot.time * alpha;
          bodies = bodies.map((b, i) => ({
            ...b,
            position: b.position.map(
              (x, a) => (this.previous!.bodies[i]?.position[a] ?? x) * (1 - alpha) + x * alpha,
            ) as [number, number, number],
          }));
        }
        renderer.setSystemScale?.(snapshot.system?.galaxyScale ?? 1);
        renderer.setTermination?.(snapshot.reason);
        renderer.render(
          bodies,
          snapshot.generation,
          displayTime,
          this.settings.getSnapshot().trails,
          Math.min((now - lastRendered) / 1000, 0.1),
          this.settings.getSnapshot().trailLengthYears,
        );
        lastRendered = now;
      }
      if (this.options.synchronous && now - lastPublished >= 100) {
        this.publish();
        lastPublished = now;
      }
      frameId = requestAnimationFrame(tick);
    };
    const visibility = () => {
      cancelAnimationFrame(frameId);
      previous = null;
      this.queuedTime = 0;
      this.queuedWallTime = 0;
      this.send({ type: 'visibility', active: !document.hidden && !this.hostPaused });
      if (!document.hidden) this.scheduleRecovery();
      if (!document.hidden) frameId = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', visibility);
    visibility();
    return () => {
      this.attached = false;
      this.renderer = null;
      cancelAnimationFrame(frameId);
      document.removeEventListener('visibilitychange', visibility);
      unsubscribe();
      this.port?.terminate();
      this.port = null;
      if (this.retry !== null) clearTimeout(this.retry);
      this.retry = null;
    };
  }
}
