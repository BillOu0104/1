import {
  SimulationEngine,
  type SimulationControls,
  type ScreeningSummary,
} from '../simulation/SimulationEngine';
import { ScreeningJob, type ScreenedInitial } from '../physics/screening';
import type { PhysicsRequest, PhysicsResponse } from './protocol';
/** Testable Worker owner. Timers are injected; no rendering/DOM dependencies. */
export class PhysicsWorkerController {
  private engine: SimulationEngine | null = null;
  private job: ScreeningJob | null = null;
  private ready: ScreenedInitial | null = null;
  private masses: number[] = [];
  private controls: SimulationControls = { paused: false, speed: 1, autoRestart: true };
  private mode: 'initial' | 'manual' | 'next' = 'initial';
  private seed = '';
  private summary: ScreeningSummary | undefined;
  private active = true;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;
  private lastProgress = -1;
  private budgetMs = 4;
  private lastEventId = -1;
  private session: Extract<PhysicsRequest, { type: 'init' }>['session'];
  constructor(
    private readonly send: (message: PhysicsResponse) => void,
    private readonly schedule = (fn: () => void, ms: number) => setTimeout(fn, ms),
    private readonly cancel = (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  ) {}
  receive(message: PhysicsRequest): void {
    if (this.disposed) return;
    try {
      if (
        (message.type === 'init' || message.type === 'reset') &&
        (message.masses.length !== 3 ||
          !message.masses.every((m) => Number.isFinite(m) && m >= 0.08 && m <= 3))
      )
        throw new Error('Invalid stellar masses');
      if (message.type === 'init') {
        this.masses = message.masses;
        this.controls = message.controls;
        this.session = message.session;
        this.begin(message.seed, 'initial');
        return;
      }
      if (message.type === 'reset') {
        this.masses = message.masses;
        this.begin(message.seed, 'manual');
        return;
      }
      if (message.type === 'controls') {
        this.controls = message.controls;
        this.engine?.setControls(this.controls);
        this.emit();
        this.queue();
        return;
      }
      if (message.type === 'visibility') {
        this.active = message.active;
        if (this.active) this.queue();
        else this.stopTimer();
        return;
      }
      if (message.type === 'tick') {
        const before = performance.now(),
          generation = this.engine?.getGeneration();
        if (this.active && this.mode !== 'initial' && this.mode !== 'manual')
          this.engine?.advance(message.elapsed, this.budgetMs);
        const cpuMs = performance.now() - before;
        // Bound Worker CPU per request. Load control never relaxes tolerances or raises numerical dt.
        this.budgetMs = Math.max(1, Math.min(4, this.budgetMs + (cpuMs > 5 ? -0.4 : 0.05)));
        if (this.engine && generation !== this.engine.getGeneration()) {
          this.summary = this.ready?.summary;
          if (this.summary?.fallback)
            this.engine?.warn('未找到完全合格候选，采用已试候选中存活最久者');
          this.ready = null;
          this.begin(this.engine.nextSeed(), 'next');
        }
        this.emit(message.sequence, cpuMs);
      }
    } catch (error) {
      this.send({
        type: 'error',
        message: error instanceof Error ? error.message : 'Worker physics error',
      });
    }
  }
  private begin(seed: string, mode: 'initial' | 'manual' | 'next'): void {
    this.revision++;
    this.stopTimer();
    this.seed = seed;
    this.mode = mode;
    this.ready = null;
    this.lastProgress = -1;
    this.job = new ScreeningJob(seed, this.masses);
    this.send({ type: 'screening', progress: 0, initial: mode !== 'next' });
    this.queue();
  }
  private queue(): void {
    if (
      this.timer !== null ||
      !this.active ||
      this.disposed ||
      !this.job ||
      (this.mode === 'next' && (this.controls.paused || !this.controls.autoRestart))
    )
      return;
    const revision = this.revision;
    this.timer = this.schedule(() => {
      this.timer = null;
      if (revision !== this.revision || !this.active || !this.job) return;
      try {
        const done = this.job.pump(1.5),
          progress = this.job.progress;
        if (progress !== this.lastProgress) {
          this.send({ type: 'screening', progress, initial: this.mode !== 'next' });
          this.lastProgress = progress;
        }
        if (done) {
          const result = this.job.getResult();
          this.job = null;
          if (this.mode === 'next') this.ready = result;
          else {
            if (this.engine) this.engine.reset(this.seed, result.bodies);
            else
              this.engine = new SimulationEngine(this.seed, {
                initialBodies: result.bodies,
                session: this.session,
                restartProvider: (seed) =>
                  seed === this.seed && this.ready ? this.ready.bodies : null,
              });
            this.engine.setControls(this.controls);
            this.summary = result.summary;
            if (result.summary.fallback)
              this.engine.warn('未找到完全合格候选，采用已试候选中存活最久者');
            this.mode = 'next';
            this.emit();
            this.begin(this.engine.nextSeed(), 'next');
          }
        } else this.queue();
      } catch (error) {
        this.send({
          type: 'error',
          message: error instanceof Error ? error.message : 'Screening failed',
        });
      }
    }, 12);
  }
  private emit(sequence?: number, cpuMs = 0): void {
    if (!this.engine) return;
    const snapshot = this.engine.snapshot();
    const eventId = snapshot.events[0]?.id ?? 0;
    const eventsUnchanged = eventId === this.lastEventId;
    this.lastEventId = eventId;
    if (eventsUnchanged) snapshot.events = [];
    snapshot.screening = this.summary;
    if (this.mode === 'initial' || this.mode === 'manual') snapshot.phase = 'screening';
    this.send({ type: 'snapshot', snapshot, sequence, workerCpuMs: cpuMs, eventsUnchanged });
  }
  private stopTimer(): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
  dispose(): void {
    this.disposed = true;
    this.revision++;
    this.stopTimer();
  }
}
