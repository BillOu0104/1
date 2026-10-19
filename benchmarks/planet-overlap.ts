import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { RandomInitializer } from '../src/physics/initialConditions';
import { DEFAULT_CAGE } from '../src/physics/cage';
import { DEFAULT_PHYSICS, UNITS_PER_YEAR, type Body } from '../src/physics/types';
import { centerOfMass, dot, length, sub } from '../src/physics/vector';
import type { EndReason } from '../src/physics/detection';

const { RandomInitializer: Previous } = (await import(
  join(process.env.PLANET_BASELINE_ROOT!, 'src/physics/initialConditions.ts')
)) as { RandomInitializer: typeof RandomInitializer };
const count = Number(process.env.PLANET_BENCH_SEEDS ?? 48);
const horizon = Number(process.env.PLANET_BENCH_YEARS ?? 100);
const initialCount = Number(process.env.PLANET_INITIAL_SEEDS ?? 512);
const output = process.env.PLANET_BENCH_OUTPUT ?? 'docs/benchmarks/planet-overlap.json';

function geometry(bodies: readonly Body[]) {
  const stars = bodies.filter((b) => b.kind === 'star'),
    planet = bodies.find((b) => b.kind === 'planet')!;
  const center = centerOfMass(stars),
    radial = sub(planet.position, center);
  const radius = length(radial),
    distances = stars.map((s) => length(sub(s.position, planet.position)));
  const stellarRadius = Math.max(...stars.map((s) => length(sub(s.position, center))));
  const velocity = sub(planet.velocity, centerOfMass(stars, 'velocity'));
  const binding = stars.reduce(
    (total, s, i) => total + s.mass / Math.hypot(distances[i]!, DEFAULT_PHYSICS.softening),
    0,
  );
  return {
    radius,
    nearest: Math.min(...distances),
    stellarRadius,
    ratio: radius / stellarRadius,
    radialCos: dot(radial, velocity) / (radius * length(velocity)),
    speedFraction: length(velocity) / Math.sqrt(2 * binding),
    bound: 0.5 * dot(velocity, velocity) < binding,
  };
}

const initial: ({ version: string; seed: string } & ReturnType<typeof geometry>)[] = [];
for (const version of ['previous', 'overlap'] as const) {
  const generator = new (version === 'previous' ? Previous : RandomInitializer)();
  for (let i = 0; i < initialCount; i++)
    initial.push({
      version,
      seed: `planet-distribution-${i}`,
      ...geometry(generator.generate(`planet-distribution-${i}`, DEFAULT_PHYSICS)),
    });
}

interface Row {
  version: string;
  scale: number;
  cage: boolean;
  seed: string;
  observedYears: number;
  ended: boolean;
  reason: EndReason | null;
  planetDestruction: boolean;
  budget: boolean;
  initial: ReturnType<typeof geometry>;
  farFraction: number;
  farBoundFraction: number;
  closeFraction: number;
  closeVisits: number;
  minDistanceInScaleAU: number;
  steps: number;
  energyError: number;
  angularMomentumError: number;
  cpuMs: number;
}
const rows: Row[] = [];
for (const scale of [1, 3])
  for (const cage of [false, true]) {
    for (let i = 0; i < count; i++)
      for (const version of (i % 2 ? ['overlap', 'previous'] : ['previous', 'overlap']) as (
        | 'previous'
        | 'overlap'
      )[]) {
        const seed = `planet-lifetime-${i}`;
        let observed = 0,
          far = 0,
          farBound = 0,
          close = 0,
          visits = 0,
          wasClose = false,
          minDistance = Infinity;
        const started = performance.now();
        const engine = new SimulationEngine(seed, {
          generator: new (version === 'previous' ? Previous : RandomInitializer)(),
          config: { galaxyScale: scale, cage: { ...DEFAULT_CAGE, enabled: cage } },
          onAcceptedState: (bodies, time) => {
            const state = geometry(bodies),
              dt = Math.max(0, time - observed);
            const distant = state.radius > Math.max(1.5 * state.stellarRadius, 4 * scale);
            const near = state.nearest < scale;
            observed = time;
            far += distant ? dt : 0;
            farBound += distant && state.bound ? dt : 0;
            close += near ? dt : 0;
            if (near && !wasClose) visits++;
            wasClose = near;
            minDistance = Math.min(minDistance, state.nearest / scale);
          },
        });
        engine.setControls({ speed: 20, autoRestart: false });
        const initialState = geometry(engine.getBodies());
        let budget = false;
        while (!engine.getReason() && engine.getTime() / UNITS_PER_YEAR < horizon) {
          engine.advance(0.1);
          if (performance.now() - started > 15000 || engine.snapshot().steps >= 200000) {
            budget = true;
            break;
          }
        }
        const snapshot = engine.snapshot();
        const planetEnd =
          snapshot.reason?.type === 'tidal' ||
          (snapshot.reason?.type === 'collision' && snapshot.reason.bodyIds.includes('planet'));
        rows.push({
          version,
          scale,
          cage,
          seed,
          observedYears: snapshot.years,
          ended: !!snapshot.reason,
          reason: snapshot.reason,
          planetDestruction: planetEnd,
          budget,
          initial: initialState,
          farFraction: far / Math.max(observed, 1e-30),
          farBoundFraction: farBound / Math.max(observed, 1e-30),
          closeFraction: close / Math.max(observed, 1e-30),
          closeVisits: visits,
          minDistanceInScaleAU: minDistance,
          steps: snapshot.steps,
          energyError: snapshot.relativeEnergyError,
          angularMomentumError: snapshot.diagnostics.angularMomentumError,
          cpuMs: performance.now() - started,
        });
      }
    console.log(`Completed ${count} paired Seeds: ${scale}x cage=${cage}`);
  }
const quantiles = (values: number[]) => {
  const a = values.slice().sort((x, y) => x - y);
  return {
    p10: a[Math.floor((a.length - 1) * 0.1)],
    median: a[Math.floor((a.length - 1) * 0.5)],
    p90: a[Math.floor((a.length - 1) * 0.9)],
  };
};
const initialSummary = ['previous', 'overlap'].map((version) => {
  const group = initial.filter((r) => r.version === version);
  return {
    version,
    count: group.length,
    radius: quantiles(group.map((r) => r.radius)),
    nearest: quantiles(group.map((r) => r.nearest)),
    ratio: quantiles(group.map((r) => r.ratio)),
    insideStellarExtent: group.filter((r) => r.ratio < 1).length,
    radialDirectionShare: group.filter((r) => Math.abs(r.radialCos) > 0.45).length,
    speedFraction: quantiles(group.map((r) => r.speedFraction)),
  };
});
const summary = [1, 3].flatMap((scale) =>
  [false, true].flatMap((cage) =>
    ['previous', 'overlap'].map((version) => {
      const group = rows.filter(
        (r) => r.scale === scale && r.cage === cage && r.version === version,
      );
      return {
        version,
        scale,
        cage,
        count: group.length,
        earlyPlanetDestruction10: group.filter((r) => r.planetDestruction && r.observedYears <= 10)
          .length,
        earlyAllTermination10: group.filter((r) => r.ended && r.observedYears <= 10).length,
        planetDestruction: group.filter((r) => r.planetDestruction).length,
        planetEscape: group.filter(
          (r) => r.reason?.type === 'escape' && r.reason.bodyIds.includes('planet'),
        ).length,
        numerical: group.filter((r) => r.reason?.type === 'numerical').length,
        budget: group.filter((r) => r.budget).length,
        reachedHorizon: group.filter((r) => r.observedYears >= horizon).length,
        meanObservedYears:
          group.reduce((s, r) => s + Math.min(horizon, r.observedYears), 0) / group.length,
        pooledFarFraction:
          group.reduce((s, r) => s + r.farFraction * r.observedYears, 0) /
          group.reduce((s, r) => s + r.observedYears, 0),
        pooledFarBoundFraction:
          group.reduce((s, r) => s + r.farBoundFraction * r.observedYears, 0) /
          group.reduce((s, r) => s + r.observedYears, 0),
        outerDominated: group.filter((r) => r.observedYears >= 10 && r.farBoundFraction >= 0.8)
          .length,
        anyClosePass: group.filter((r) => r.closeVisits > 0).length,
        meanCloseVisits: group.reduce((s, r) => s + r.closeVisits, 0) / group.length,
        meanInitNearest: group.reduce((s, r) => s + r.initial.nearest / scale, 0) / group.length,
        cpuMs: group.reduce((s, r) => s + r.cpuMs, 0),
      };
    }),
  ),
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      baselineCommit: 'cfc2c2e0fce9d45bf9250c727f076dda3b221b41',
      node: process.version,
      count,
      initialCount,
      horizon,
      method:
        'Same current DOPRI5 engine and parameters; frozen previous vs new initializer. Measurements at every accepted step. Far: r > max(1.5 Rstars, 4*k AU); bound: negative instantaneous multisource specific energy (not a permanence proof). Outer dominated: >=80% observed time bound and far, with >=10 years observed. Close pass: nearest star < k AU. All statistics include pre-end exposure; horizon and budgets are censored.',
      initialSummary,
      summary,
      initial,
      rows,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ initialSummary, summary }, null, 2));
