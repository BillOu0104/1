import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { RandomInitializer } from '../src/physics/initialConditions';
import { DEFAULT_CAGE } from '../src/physics/cage';
import { DEFAULT_MASSES } from '../src/physics/parameters';
const { SimulationEngine: Previous } = (await import(
  join(process.env.V021_ROOT!, 'src/simulation/SimulationEngine.ts')
)) as { SimulationEngine: typeof SimulationEngine };
const { RandomInitializer: PreviousRandom } = (await import(
  join(process.env.V021_ROOT!, 'src/physics/initialConditions.ts')
)) as { RandomInitializer: typeof RandomInitializer };
const count = Number(process.env.BENCH_SEEDS ?? 24),
  horizon = Number(process.env.BENCH_YEARS ?? 1000);
const maxCpuMs = Number(process.env.BENCH_CPU_MS ?? 30000),
  maxSteps = Number(process.env.BENCH_MAX_STEPS ?? 1000000);
const configs = [
  { id: 'v021', scale: 1, cage: false },
  ...[1, 3, 5].flatMap((scale) =>
    [false, true].map((cage) => ({ id: `v03-${scale}x-${cage ? 'cage' : 'newton'}`, scale, cage })),
  ),
];
const thresholds = [10, 100, 500, 1000];
interface Row {
  seed: string;
  mode: string;
  years: number;
  observedYears: number;
  ended: boolean;
  reason: string;
  reasonMessage: string;
  detail: string;
  censored: string;
  steps: number;
  rejected: number;
  encounters: number;
  energy: number;
  rawEnergy: number;
  angular: number;
  momentum: number;
  cpuMs: number;
  initCpuMs: number;
  initial: number[];
  final: number[];
}
const rows: Row[] = [];
function run(seed: string, mode: (typeof configs)[number]): Row {
  const before = performance.now(),
    Constructor = mode.id === 'v021' ? Previous : SimulationEngine;
  const engine = new Constructor(seed, {
    generator:
      mode.id === 'v021'
        ? new PreviousRandom(DEFAULT_MASSES)
        : new RandomInitializer(DEFAULT_MASSES),
    config: {
      galaxyScale: mode.scale,
      ...(mode.id === 'v021' ? {} : { cage: { ...DEFAULT_CAGE, enabled: mode.cage } }),
    },
  });
  engine.setControls({ autoRestart: false, speed: 20 });
  const initCpuMs = performance.now() - before,
    initial = engine.getBodies().flatMap((b) => [...b.position, ...b.velocity]);
  let state = engine.snapshot(),
    energy = 0,
    rawEnergy = 0,
    angular = 0,
    momentum = 0,
    censored = 'horizon';
  const start = performance.now();
  while (!state.reason && state.years < horizon) {
    engine.advance(0.25);
    state = engine.snapshot();
    energy = Math.max(energy, Math.abs(state.relativeEnergyError));
    rawEnergy = Math.max(
      rawEnergy,
      Math.abs(state.system?.rawEnergyChange ?? state.relativeEnergyError),
    );
    angular = Math.max(angular, state.diagnostics.angularMomentumError);
    momentum = Math.max(momentum, state.diagnostics.momentumError);
    if (state.steps >= maxSteps) {
      censored = 'step-budget';
      break;
    }
    if (performance.now() - start >= maxCpuMs) {
      censored = 'cpu-budget';
      break;
    }
  }
  const reason = state.reason,
    involved = state.bodies.filter((b) => reason?.bodyIds.includes(b.id));
  const detail =
    reason?.type === 'collision'
      ? (reason.collisionKind ??
        (involved.some((b) => b.kind === 'planet') ? 'planetary' : 'stellar'))
      : reason?.type === 'escape'
        ? (reason.escapeKind ?? (involved.some((b) => b.kind === 'planet') ? 'planet' : 'star'))
        : reason?.type === 'tidal'
          ? 'planet'
          : 'none';
  return {
    seed,
    mode: mode.id,
    years: Math.min(state.years, horizon),
    observedYears: state.years,
    ended: !!reason,
    reason: reason?.type ?? 'censored',
    reasonMessage: reason?.message ?? '',
    detail,
    censored: reason ? '' : censored,
    steps: state.steps,
    rejected: state.diagnostics.rejected,
    encounters: state.diagnostics.encounters,
    energy,
    rawEnergy,
    angular,
    momentum,
    cpuMs: performance.now() - start,
    initCpuMs,
    initial,
    final: state.bodies.flatMap((b) => b.position),
  };
}
// Warm identical code paths without including warm-up in results.
run('lifetime-warm', { id: 'v03-1x-newton', scale: 1, cage: false });
const started = performance.now();
const output = process.env.BENCH_OUTPUT ?? 'docs/benchmarks/v03-lifetime.json';
function report() {
  const modes = configs.map((c) => {
    const group = rows.filter((r) => r.mode === c.id),
      sorted = group.map((r) => r.years).sort((a, b) => a - b);
    const median =
      sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]!
        : ((sorted[sorted.length / 2 - 1] ?? 0) + (sorted[sorted.length / 2] ?? 0)) / 2;
    return {
      ...c,
      n: group.length,
      meanObservedYears: group.reduce((s, r) => s + r.years, 0) / Math.max(1, group.length),
      medianObservedYears: median ?? 0,
      longestObservedYears: sorted.at(-1) ?? 0,
      ended: group.filter((r) => r.ended).length,
      censoredByBudget: group.filter((r) => !r.ended && r.censored !== 'horizon').length,
      survival: thresholds.map((year) => ({
        year,
        reached: group.filter((r) => r.observedYears >= year).length,
        endedBefore: group.filter((r) => r.ended && r.observedYears < year).length,
        unknown: group.filter((r) => !r.ended && r.observedYears < year).length,
        lowerBoundRate:
          group.filter((r) => r.observedYears >= year).length / Math.max(1, group.length),
      })),
      causes: Object.fromEntries(
        [
          'collision:stellar',
          'collision:planetary',
          'escape:star',
          'escape:planet',
          'tidal:planet',
          'numerical:none',
        ].map((cause) => [cause, group.filter((r) => `${r.reason}:${r.detail}` === cause).length]),
      ),
      meanInitCpuMs: group.reduce((s, r) => s + r.initCpuMs, 0) / Math.max(1, group.length),
      cpuMs: group.reduce((s, r) => s + r.cpuMs, 0),
      steps: group.reduce((s, r) => s + r.steps, 0),
      maxEnergy: Math.max(0, ...group.map((r) => r.energy)),
      maxAngular: Math.max(0, ...group.map((r) => r.angular)),
      uniqueInitials: new Set(group.map((r) => JSON.stringify(r.initial))).size,
      uniqueFinals: new Set(group.map((r) => JSON.stringify(r.final))).size,
    };
  });
  return {
    schema: 1,
    baselineCommit: '762ae5024c8369a8ffca3c187b602ee3ff7d5827',
    node: process.version,
    cpu: cpus()[0]?.model,
    count,
    horizon,
    maxCpuMs,
    maxSteps,
    elapsedMs: performance.now() - started,
    method:
      'No screening. Same seed list/reference masses; all four-body gravity, tides, actual terminations retained. Default integrator/tolerances and production work/impulse diagnostics. No Worker/rendering/trail cost. Lifetimes truncated at horizon; budget-censored rows are unknown beyond observation. Rates are lower bounds when unknown>0.',
    modes,
    rows,
  };
}
mkdirSync(dirname(output), { recursive: true });
for (let i = 0; i < count; i++) {
  const seed = `lifetime-v03-${i}`;
  for (const mode of i % 2 ? [...configs].reverse() : configs) {
    const row = run(seed, mode);
    rows.push(row);
    console.log(
      `${mode.id} ${seed}: ${row.years.toFixed(2)} yr ${row.reason}/${row.detail} ${row.censored} ${row.cpuMs.toFixed(0)}ms E=${row.energy.toExponential(2)}`,
    );
    writeFileSync(output, JSON.stringify(report(), null, 2) + '\n');
  }
}
console.log(JSON.stringify(report().modes, null, 2));
