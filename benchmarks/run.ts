import { writeFileSync, mkdirSync } from 'node:fs';
import { cpus, platform } from 'node:os';
import { dirname } from 'node:path';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { SimulationEngine as BaselineEngine } from './baseline/simulation/SimulationEngine';
import { DEFAULT_PHYSICS as BASE_CONFIG } from './baseline/physics/types';
import { VelocityVerlet as LegacyVerlet } from './baseline/physics/velocityVerlet';
import { VelocityVerlet } from '../src/physics/velocityVerlet';
import { Yoshida4 } from '../src/physics/yoshida4';
import { AdaptiveDopri5 } from '../src/physics/adaptive';
import { DEFAULT_PHYSICS, UNITS_PER_YEAR, copyBodies, type Integrator } from '../src/physics/types';
import { StructuredChaosInitializer } from '../src/physics/structuredChaos';
import { DEFAULT_MASSES } from '../src/physics/parameters';
import { screenSynchronously } from '../src/physics/screening';
import { EncounterTracker, errors, invariants } from '../src/physics/diagnostics';
const count = Number(process.env.BENCH_SEEDS ?? 24),
  horizon = Number(process.env.BENCH_YEARS ?? 20);
const seeds = Array.from({ length: count }, (_, i) => `benchmark-v2-${i}`);
const quantile = (values: number[], q: number) =>
  [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)] ?? 0;
interface Row {
  seed: string;
  years: number;
  reason: string;
  energy: number;
  angular: number;
  momentum: number;
  encounters: number;
  exchanges: number;
  cpuMs: number;
  steps: number;
  screenMs: number;
}
function population(mode: 'v01' | 'raw-v02' | 'screened-v02'): Row[] {
  return seeds.map((seed) => {
    const start = performance.now();
    const screened = mode === 'screened-v02' ? screenSynchronously(seed, DEFAULT_MASSES) : null;
    const screenMs = performance.now() - start;
    const engine =
      mode === 'v01'
        ? new BaselineEngine(seed)
        : new SimulationEngine(seed, {
            generator: new StructuredChaosInitializer(),
            ...(screened ? { initialBodies: screened.bodies } : {}),
          });
    engine.setControls({ autoRestart: false, speed: 20 });
    const config = mode === 'v01' ? BASE_CONFIG : DEFAULT_PHYSICS,
      initial = invariants(engine.getBodies(), config),
      tracker = new EncounterTracker();
    let energy = 0,
      angular = 0,
      momentum = 0,
      state = engine.snapshot(),
      iterations = 0;
    const run = performance.now();
    while (!state.reason && state.years < horizon && iterations++ < 20000) {
      engine.advance(0.05);
      state = engine.snapshot();
      tracker.update(state.bodies);
      const e = errors(initial, state.bodies, config);
      energy = Math.max(energy, Math.abs(e.energy));
      angular = Math.max(angular, e.angularMomentum);
      momentum = Math.max(momentum, e.momentum);
    }
    return {
      seed,
      years: Math.min(state.years, horizon),
      reason: state.years >= horizon ? 'censored' : (state.reason?.type ?? 'censored'),
      energy,
      angular,
      momentum,
      encounters: tracker.count,
      exchanges: tracker.exchanges,
      cpuMs: performance.now() - run,
      steps: state.steps,
      screenMs,
    };
  });
}
function summary(rows: Row[]) {
  return {
    seeds: rows.length,
    horizonYears: horizon,
    earlyEndsWithin5Years:
      rows.filter((r) => r.years < 5 && r.reason !== 'censored').length / rows.length,
    survivedHorizon: rows.filter((r) => r.reason === 'censored').length / rows.length,
    survivalYears: {
      min: Math.min(...rows.map((r) => r.years)),
      p25: quantile(
        rows.map((r) => r.years),
        0.25,
      ),
      median: quantile(
        rows.map((r) => r.years),
        0.5,
      ),
      p75: quantile(
        rows.map((r) => r.years),
        0.75,
      ),
    },
    medianEncounters: quantile(
      rows.map((r) => r.encounters),
      0.5,
    ),
    medianExchanges: quantile(
      rows.map((r) => r.exchanges),
      0.5,
    ),
    maxEnergyError: Math.max(...rows.map((r) => r.energy)),
    maxAngularError: Math.max(...rows.map((r) => r.angular)),
    maxMomentumError: Math.max(...rows.map((r) => r.momentum)),
    cpuMs: rows.reduce((s, r) => s + r.cpuMs, 0),
    screenMs: rows.reduce((s, r) => s + r.screenMs, 0),
    reasons: rows.reduce<Record<string, number>>(
      (s, r) => ({ ...s, [r.reason]: (s[r.reason] ?? 0) + 1 }),
      {},
    ),
  };
}
const algorithms: { name: string; factory: () => Integrator | AdaptiveDopri5; dt: number }[] = [
  { name: 'v01-verlet-dt.002', factory: () => new LegacyVerlet(), dt: 0.002 },
  { name: 'cached-verlet-dt.002', factory: () => new VelocityVerlet(), dt: 0.002 },
  { name: 'cached-verlet-dt.0002', factory: () => new VelocityVerlet(), dt: 0.0002 },
  { name: 'yoshida4-dt.002', factory: () => new Yoshida4(), dt: 0.002 },
  ...[1e-7, 1e-9, 1e-11].map((relativeTolerance) => ({
    name: `adaptive-dopri5-rtol${relativeTolerance}`,
    factory: () => new AdaptiveDopri5({ relativeTolerance }),
    dt: 0.06,
  })),
];
function compare() {
  return algorithms.map((algorithm) => {
    let cpuMs = 0,
      steps = 0,
      rejected = 0,
      maxEnergy = 0,
      maxAngular = 0;
    const trajectories: { seed: string; energy: number; angular: number; steps: number }[] = [];
    for (const seed of seeds.slice(0, 6)) {
      const bodies = copyBodies(new StructuredChaosInitializer().generate(seed, DEFAULT_PHYSICS)),
        integrator = algorithm.factory(),
        initial = invariants(bodies, DEFAULT_PHYSICS);
      let t = 0,
        localSteps = 0,
        energy = 0,
        angular = 0;
      while (t < 5 * UNITS_PER_YEAR && localSteps < 300000) {
        const before = performance.now();
        let dt = Math.min(algorithm.dt, 5 * UNITS_PER_YEAR - t);
        if (integrator instanceof AdaptiveDopri5) {
          const result = integrator.attempt(bodies, dt, DEFAULT_PHYSICS);
          cpuMs += performance.now() - before;
          if (!result.accepted) {
            rejected++;
            continue;
          }
          dt = result.dt;
        } else {
          integrator.step(bodies, dt, DEFAULT_PHYSICS);
          cpuMs += performance.now() - before;
        }
        t += dt;
        localSteps++;
        if (localSteps % 10 === 0) {
          const e = errors(initial, bodies, DEFAULT_PHYSICS);
          energy = Math.max(energy, Math.abs(e.energy));
          angular = Math.max(angular, e.angularMomentum);
        }
        if (!bodies.every((b) => [...b.position, ...b.velocity].every(Number.isFinite))) break;
      }
      steps += localSteps;
      maxEnergy = Math.max(maxEnergy, energy);
      maxAngular = Math.max(maxAngular, angular);
      trajectories.push({ seed, energy, angular, steps: localSteps });
    }
    return { name: algorithm.name, cpuMs, steps, rejected, maxEnergy, maxAngular, trajectories };
  });
}
// Warm JIT before timed comparisons; population costs include actual end detection and diagnostics.
for (let i = 0; i < 3; i++) {
  const b = new StructuredChaosInitializer().generate('warmup', DEFAULT_PHYSICS),
    v = new VelocityVerlet();
  for (let j = 0; j < 500; j++) v.step(b, 0.001, DEFAULT_PHYSICS);
}
const repetitions = 3;
// Each algorithm sees an untimed first run, including JIT compilation.
compare();
const repeated = Array.from({ length: repetitions }, () => compare());
const algorithmResults = repeated[0]!.map((result, i) => {
  const samples = repeated.map((run) => run[i]!.cpuMs).sort((a, b) => a - b);
  return { ...result, cpuMs: samples[1]!, cpuMsRange: [samples[0]!, samples.at(-1)!], repetitions };
});
console.log(
  'Integrator comparison',
  algorithmResults.map(({ trajectories: _, ...r }) => r),
);
const populations = Object.fromEntries(
  (['v01', 'raw-v02', 'screened-v02'] as const).map((mode) => {
    const rows = population(mode),
      stats = summary(rows);
    console.log(mode, stats);
    return [mode, { summary: stats, rows }];
  }),
);
const report = {
  schema: 1,
  baselineCommit: '83acfeb12d3405855226e29040ca2ce4994ada16',
  node: process.version,
  platform: platform(),
  cpu: cpus()[0]?.model,
  count,
  horizonYears: horizon,
  seeds,
  algorithms: algorithmResults,
  populations,
};
const output = process.env.BENCH_OUTPUT ?? 'test-results/experimental-current.json';
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
