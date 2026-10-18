import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { DEFAULT_CAGE } from '../src/physics/cage';
import { UNITS_PER_YEAR } from '../src/physics/types';

// Equal physical requests at each target: measures accuracy/cost, not a real-time hardware promise.
const rows = [];
for (let i = 0; i < 8; i++) {
  let reference: string | undefined;
  for (const speed of [1, 20, 100]) {
    const seed = `v031-speed-${i}`;
    const engine = new SimulationEngine(seed, {
      config: { galaxyScale: 3, cage: { ...DEFAULT_CAGE } },
    });
    engine.setControls({ speed, autoRestart: false });
    const started = performance.now();
    while (!engine.getReason() && engine.getTime() / UNITS_PER_YEAR < 100)
      engine.advance(0.2 / speed);
    const cpuMs = performance.now() - started;
    const snapshot = engine.snapshot();
    const state = JSON.stringify([snapshot.time, snapshot.bodies, snapshot.reason]);
    reference ??= state;
    rows.push({
      seed,
      targetSpeed: speed,
      observedYears: snapshot.years,
      cpuMs,
      steps: snapshot.steps,
      energyError: snapshot.relativeEnergyError,
      angularMomentumError: snapshot.diagnostics.angularMomentumError,
      reason: snapshot.reason,
      identicalTo1x: state === reference,
    });
  }
}
const output = process.env.SPEED_BENCH_OUTPUT ?? 'docs/benchmarks/v031-speed.json';
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      version: '0.3.1',
      generatedAt: new Date().toISOString(),
      method:
        '8 Seeds, 100 physical years, equal .12 T0 requests; no wall-clock budget. Measures numerical equivalence, not achievable real-time speed.',
      rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(rows));
if (rows.some((r) => !r.identicalTo1x || r.reason?.type === 'numerical'))
  throw new Error('Speed equivalence failed');
