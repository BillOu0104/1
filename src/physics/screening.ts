/** Historical V0.2 experiment. Not imported by the V0.2.1 app/Worker; retained for offline comparisons. */
import { SimulationEngine, type ScreeningSummary } from '../simulation/SimulationEngine';
import { StructuredChaosInitializer, acceptableChaos } from './structuredChaos';
import { copyBodies, DEFAULT_PHYSICS, UNITS_PER_YEAR, type Body } from './types';
import { seededRandom } from './random';
import type { EndReason } from './detection';
export interface CandidateReport {
  index: number;
  initial: Body[];
  years: number;
  steps: number;
  encounters: number;
  exchanges: number;
  energyError: number;
  angularError: number;
  reason: EndReason | null;
  score: number;
  qualified: boolean;
}
export interface ScreeningOptions {
  candidates: number;
  years: number;
  maxStepsPerCandidate: number;
  maxBatchesPerCandidate: number;
}
export const DEFAULT_SCREENING: Readonly<ScreeningOptions> = {
  candidates: 6,
  years: 5,
  maxStepsPerCandidate: 6000,
  maxBatchesPerCandidate: 300,
};
export interface ScreenedInitial {
  bodies: Body[];
  summary: ScreeningSummary;
  reports: CandidateReport[];
}
/** Deterministic operation limits decide the result. Millisecond limits only yield scheduling. */
export class ScreeningJob {
  private index = 0;
  private preview: SimulationEngine | null = null;
  private original: Body[] = [];
  private batches = 0;
  private cpuMs = 0;
  private reports: CandidateReport[] = [];
  private result: ScreenedInitial | null = null;
  readonly options: ScreeningOptions;
  constructor(
    readonly seed: string,
    private readonly masses: readonly number[],
    options: Partial<ScreeningOptions> = {},
  ) {
    this.options = { ...DEFAULT_SCREENING, ...options };
  }
  get done(): boolean {
    return this.result !== null;
  }
  get progress(): number {
    return this.index / this.options.candidates;
  }
  getResult(): ScreenedInitial {
    if (!this.result) throw new Error('Screening not finished');
    return this.result;
  }
  pump(budgetMs = 2): boolean {
    const start = performance.now();
    do {
      if (this.result) break;
      if (!this.preview) {
        this.original = new StructuredChaosInitializer(this.masses).generate(
          `${this.seed}:candidate:${this.index}`,
          DEFAULT_PHYSICS,
        );
        this.preview = new SimulationEngine(this.seed, {
          initialBodies: this.original,
          config: { maxStepsPerFrame: 32 },
        });
        this.preview.setControls({ autoRestart: false, speed: 20 });
        this.batches = 0;
      }
      this.preview.advance(0.02);
      this.batches++;
      const state = this.preview.snapshot();
      if (
        state.reason ||
        state.years >= this.options.years ||
        state.steps >= this.options.maxStepsPerCandidate ||
        this.batches >= this.options.maxBatchesPerCandidate
      ) {
        const qualified =
          !state.reason &&
          state.years >= this.options.years &&
          Math.abs(state.relativeEnergyError) < 1e-5 &&
          acceptableChaos(this.original, DEFAULT_PHYSICS);
        const score =
          ((1 + state.diagnostics.encounters * 0.6 + state.diagnostics.exchanges * 0.3) *
            Math.min(1, state.years / this.options.years)) /
          (1 + Math.abs(state.relativeEnergyError) * 1e5);
        this.reports.push({
          index: this.index,
          initial: this.original,
          years: state.years,
          steps: state.steps,
          encounters: state.diagnostics.encounters,
          exchanges: state.diagnostics.exchanges,
          energyError: Math.abs(state.relativeEnergyError),
          angularError: state.diagnostics.angularMomentumError,
          reason: state.reason,
          score,
          qualified,
        });
        this.index++;
        this.preview = null;
        if (this.index >= this.options.candidates) this.finish();
      }
    } while (performance.now() - start < budgetMs);
    this.cpuMs += performance.now() - start;
    if (this.result) this.result.summary.cpuMs = this.cpuMs;
    return this.done;
  }
  private finish(): void {
    const qualified = this.reports.filter((r) => r.qualified);
    let selected: CandidateReport;
    if (qualified.length) {
      let sample =
        seededRandom(`selection:${this.seed}`)() * qualified.reduce((s, r) => s + r.score, 0);
      selected = qualified.at(-1)!;
      for (const candidate of qualified) {
        sample -= candidate.score;
        if (sample <= 0) {
          selected = candidate;
          break;
        }
      }
    } else selected = [...this.reports].sort((a, b) => b.years - a.years || b.score - a.score)[0]!;
    this.result = {
      bodies: copyBodies(selected.initial),
      reports: this.reports,
      summary: {
        mode: 'Structured Chaos',
        candidates: this.reports.length,
        qualified: qualified.length,
        fallback: qualified.length === 0,
        selectedCandidate: selected.index,
        previewYears: selected.years,
        previewSteps: this.reports.reduce((s, r) => s + r.steps, 0),
        score: selected.score,
        cpuMs: this.cpuMs,
      },
    };
  }
}
export function screenSynchronously(
  seed: string,
  masses: readonly number[],
  options: Partial<ScreeningOptions> = {},
): ScreenedInitial {
  const job = new ScreeningJob(seed, masses, options);
  while (!job.pump(Infinity)) {}
  return job.getResult();
}
export const SCREENING_HORIZON_UNITS = DEFAULT_SCREENING.years * UNITS_PER_YEAR;
