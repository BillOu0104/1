import { join, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { RandomInitializer } from '../src/physics/initialConditions';
import { DEFAULT_MASSES } from '../src/physics/parameters';
import { DEFAULT_PHYSICS, type Body } from '../src/physics/types';
import { TrajectoryRecorder } from '../src/physics/trajectory';
const { SimulationEngine: Previous } = (await import(
  join(process.env.V02_ROOT!, 'src/simulation/SimulationEngine.ts')
)) as { SimulationEngine: typeof SimulationEngine };
const count = Number(process.env.BENCH_SEEDS ?? 24),
  years = Number(process.env.BENCH_YEARS ?? 10);
const quantile = (a: number[], q: number) =>
  [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * q)] ?? 0;
function run(
  Engine: typeof SimulationEngine,
  seed: string,
  initialBodies: Body[],
  record: boolean,
  escape: boolean,
) {
  const recorder = new TrajectoryRecorder();
  const engine = new Engine(seed, {
    initialBodies,
    config: escape ? {} : { escapeDistance: 1e12, escapePolicy: { earlyDistance: 1e12 } },
    ...(record ? { onAcceptedState: (b, t, g) => recorder.capture(b, t, g) } : {}),
  });
  engine.setControls({ autoRestart: false, speed: 20 });
  let s = engine.snapshot(),
    maxEnergy = 0,
    maxAngular = 0,
    points = 0,
    maxBatch = 0;
  const start = performance.now();
  for (let i = 0; i < 20000 && !s.reason && s.years < years; i++) {
    engine.advance(0.05);
    s = engine.snapshot();
    maxEnergy = Math.max(maxEnergy, Math.abs(s.relativeEnergyError));
    maxAngular = Math.max(maxAngular, s.diagnostics.angularMomentumError);
    if (record) {
      const n = recorder.drain().points.length / 5;
      points += n;
      maxBatch = Math.max(maxBatch, n);
    }
  }
  return {
    cpuMs: performance.now() - start,
    time: s.time,
    years: s.years,
    steps: s.steps,
    maxEnergy,
    maxAngular,
    reason: s.reason?.type ?? 'censored',
    encounters: s.diagnostics.encounters,
    bodies: s.bodies,
    evidence: s.reason?.escape,
    points,
    maxBatch,
  };
}
const fixtures = Array.from({ length: count }, (_, i) => ({
  seed: `fix-bench-${i}`,
  bodies: new RandomInitializer(DEFAULT_MASSES).generate(`fix-bench-${i}`, DEFAULT_PHYSICS),
}));
// Warm both complete engine paths. Three alternating repetitions include trajectory transport preparation.
run(Previous, fixtures[0]!.seed, fixtures[0]!.bodies, false, false);
run(SimulationEngine, fixtures[0]!.seed, fixtures[0]!.bodies, true, false);
const rows = [];
for (let repetition = 0; repetition < 3; repetition++)
  for (const f of fixtures) {
    const oldFirst = repetition % 2 === 0;
    const a = oldFirst
      ? run(Previous, f.seed, f.bodies, false, false)
      : run(SimulationEngine, f.seed, f.bodies, true, false);
    const b = oldFirst
      ? run(SimulationEngine, f.seed, f.bodies, true, false)
      : run(Previous, f.seed, f.bodies, false, false);
    const old = oldFirst ? a : b,
      current = oldFirst ? b : a;
    const same =
      old.time === current.time &&
      old.steps === current.steps &&
      JSON.stringify(old.bodies) === JSON.stringify(current.bodies);
    if (!same) throw new Error(`Physical trajectory regression: ${f.seed}`);
    rows.push({
      seed: f.seed,
      repetition,
      identicalPhysicalState: same,
      v02: { ...old, bodies: undefined },
      v021: { ...current, bodies: undefined },
    });
  }
const outbound: Body[] = [
  {
    id: 'out',
    name: 'planet',
    kind: 'planet',
    mass: 3e-6,
    radius: 1e-7,
    color: '#fff',
    position: [21, 0, 0],
    velocity: [2, 0, 0],
  },
  {
    id: 'host',
    name: 'star',
    kind: 'star',
    mass: 1,
    radius: 0.00465,
    color: '#fff',
    position: [0, 0, 0],
    velocity: [0, 0, 0],
  },
];
const escape = {
  v02: run(Previous, 'escape', outbound, false, true),
  v021: run(SimulationEngine, 'escape', outbound, true, true),
};
const summary = {
  identicalPhysicalTrajectories: rows.every((r) => r.identicalPhysicalState),
  medianCpuMs: {
    v02: quantile(
      rows.map((r) => r.v02.cpuMs),
      0.5,
    ),
    v021: quantile(
      rows.map((r) => r.v021.cpuMs),
      0.5,
    ),
  },
  totalCpuSamplesMs: {
    v02: rows.reduce((s, r) => s + r.v02.cpuMs, 0),
    v021: rows.reduce((s, r) => s + r.v021.cpuMs, 0),
  },
  maxEnergy: Math.max(...rows.map((r) => r.v021.maxEnergy)),
  maxAngular: Math.max(...rows.map((r) => r.v021.maxAngular)),
  largestBatchPoints: Math.max(...rows.map((r) => r.v021.maxBatch)),
};
const result = {
  baselineCommit: '39d830bdcbf13bc0c4c7e0e799115c42b6303265',
  node: process.version,
  cpu: cpus()[0]?.model,
  count,
  years,
  repetitions: 3,
  method:
    'Same Random bodies, no escape for precision runs; existing real collision/tide/numerical stopping retained. V0.2.1 includes accepted-state recorder and batch preparation. Alternating paired runs after warmup.',
  summary,
  escape,
  rows,
};
const output = process.env.BENCH_OUTPUT ?? 'docs/benchmarks/v021.json';
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      summary,
      escape: {
        v02Years: escape.v02.years,
        v021Years: escape.v021.years,
        v021DistanceAU: escape.v021.evidence?.distanceAU,
      },
    },
    null,
    2,
  ),
);
