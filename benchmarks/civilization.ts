import { writeFileSync, mkdirSync } from 'node:fs';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { RandomInitializer } from '../src/physics/initialConditions';
import { OriginalRandomInitializer, ORIGINAL_MASS_SOLAR } from '../src/physics/originalInitializer';
import { EARTH_MASS } from '../src/physics/parameters';
import { V04_DEFAULTS } from '../src/environment/config';
import { DEFAULT_CAGE } from '../src/physics/cage';
import { UNITS_PER_YEAR } from '../src/physics/types';
import type { EndReason } from '../src/physics/detection';
interface Row {
  mode: string;
  seed: string;
  years: number;
  censored: boolean;
  cpuMs: number;
  steps: number;
  reason: EndReason | null;
  energyError: number;
  angularError: number;
  civilizations: number;
  events: number;
  records: number;
  environmentBytes: number;
}
const rows: Row[] = [];
for (let i = 0; i < 12; i++)
  for (const mode of ['v031-legacy', 'original-project', 'original-earth-control']) {
    const seed = `v04-comparison-${i}`,
      environment = {
        ...V04_DEFAULTS,
        planetMassOriginal:
          mode === 'original-earth-control'
            ? EARTH_MASS / ORIGINAL_MASS_SOLAR
            : V04_DEFAULTS.planetMassOriginal,
      };
    const generator =
      mode === 'v031-legacy'
        ? new RandomInitializer()
        : new OriginalRandomInitializer(undefined, environment);
    const engine = new SimulationEngine(seed, {
      generator,
      environment,
      config: { galaxyScale: 3, cage: { ...DEFAULT_CAGE } },
    });
    engine.setControls({ speed: 100, autoRestart: false });
    const start = performance.now();
    while (
      !engine.getReason() &&
      engine.getTime() / UNITS_PER_YEAR < 100 &&
      performance.now() - start < 2000
    )
      engine.advance(0.02);
    const s = engine.snapshot();
    rows.push({
      mode,
      seed,
      years: s.years,
      censored: !s.reason,
      cpuMs: performance.now() - start,
      steps: s.steps,
      reason: s.reason,
      energyError: s.relativeEnergyError,
      angularError: s.diagnostics.angularMomentumError,
      civilizations: s.environment!.totalCivilizations,
      events: s.environment!.events.length,
      records: s.environment!.records.length,
      environmentBytes: JSON.stringify(s.environment).length,
    });
  }
const groups = Object.fromEntries(
  ['v031-legacy', 'original-project', 'original-earth-control'].map((mode) => {
    const r = rows.filter((x) => x.mode === mode),
      y = r.map((x) => x.years).sort((a, b) => a - b);
    return [
      mode,
      {
        samples: r.length,
        restrictedMeanYears: y.reduce((a, b) => a + b, 0) / y.length,
        medianObservedYears: (y[5]! + y[6]!) / 2,
        longestObservedYears: y.at(-1),
        censored: r.filter((x) => x.censored).length,
        survived10: r.filter((x) => x.years >= 10).length / r.length,
        survived100: r.filter((x) => x.years >= 100).length / r.length,
        numericalFailures: r.filter((x) => x.reason?.type === 'numerical').length,
        cpuMs: r.reduce((a, b) => a + b.cpuMs, 0),
      },
    ];
  }),
);
mkdirSync('docs/benchmarks', { recursive: true });
writeFileSync(
  'docs/benchmarks/v04-civilization.json',
  JSON.stringify(
    {
      version: '0.4.0',
      date: new Date().toISOString(),
      method:
        '12 fixed Seeds per mode, current unchanged DOPRI5/cage, scale3; 100 physical years or 2s CPU per trial. V031 uses legacy initialization with current environment observer. Original project planet mass differs; Earth-mass control separates that effect. Censored lifetimes are lower bounds; no extrapolation to 500/1000 years.',
      groups,
      rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(groups, null, 2));
// Isolate observer cost using identical deterministic accepted physics, not a different integrator.
const overhead = [];
for (const enabled of [false, true]) {
  const e = new SimulationEngine('v04-overhead', {
    generator: new OriginalRandomInitializer(),
    config: { galaxyScale: 3, cage: { ...DEFAULT_CAGE } },
  });
  if (!enabled) e.environment.observe = () => {};
  e.setControls({ speed: 100, autoRestart: false });
  const start = performance.now();
  for (let n = 0; n < 2000 && !e.getReason(); n++) e.advance(0.002);
  const s = e.snapshot();
  overhead.push({
    enabled,
    cpuMs: performance.now() - start,
    years: s.years,
    steps: s.steps,
    physics: JSON.stringify([s.bodies, s.reason]),
  });
}
if (overhead[0]!.physics !== overhead[1]!.physics) throw new Error('Observer altered physics');
writeFileSync(
  'docs/benchmarks/v04-observer-cost.json',
  JSON.stringify(
    overhead.map(({ physics, ...r }) => r),
    null,
    2,
  ) + '\n',
);
