import { writeFileSync } from 'node:fs';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { OriginalRandomInitializer } from '../src/physics/originalInitializer';
import { DEFAULT_CAGE } from '../src/physics/cage';
import { UNITS_PER_YEAR } from '../src/physics/types';
const rows = [];
for (let i = 0; i < 4; i++) {
  const e = new SimulationEngine(`v04-soak-${i}`, {
    generator: new OriginalRandomInitializer(),
    config: { galaxyScale: 3, cage: { ...DEFAULT_CAGE } },
  });
  e.setControls({ speed: 100, autoRestart: false });
  const start = performance.now();
  let samples = 0,
    maxEvents = 0,
    maxRecords = 0,
    maxEras = 0,
    maxBytes = 0;
  while (
    !e.getReason() &&
    e.getTime() / UNITS_PER_YEAR < 1000 &&
    performance.now() - start < 5000
  ) {
    e.advance(0.02);
    if (++samples % 20 === 0) {
      const env = e.environment.snapshot();
      maxEvents = Math.max(maxEvents, env.events.length);
      maxRecords = Math.max(maxRecords, env.records.length);
      maxEras = Math.max(maxEras, env.eras.length);
      maxBytes = Math.max(maxBytes, JSON.stringify(env).length);
    }
  }
  const s = e.snapshot();
  rows.push({
    seed: s.seed,
    years: s.years,
    censored: !s.reason,
    cpuMs: performance.now() - start,
    steps: s.steps,
    reason: s.reason,
    maxEvents,
    maxRecords,
    maxEras,
    maxSnapshotBytes: maxBytes,
    civilizations: s.environment!.totalCivilizations,
    energyError: s.relativeEnergyError,
    angularError: s.diagnostics.angularMomentumError,
  });
  if (maxEvents > 512 || maxRecords > 256 || maxEras > 256) throw new Error('Unbounded history');
}
writeFileSync(
  'docs/benchmarks/v04-soak.json',
  JSON.stringify(
    {
      method:
        '4 fixed Seeds, 1000 physical year observation window, 5s CPU budget per Seed, scale3 soft cage, automatic restart disabled; censored observations are lower bounds. Serialized state size is not a JS heap leak measurement.',
      rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(rows, null, 2));
