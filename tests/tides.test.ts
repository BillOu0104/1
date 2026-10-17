import { describe, expect, it } from 'vitest';
import { tidalField, principalEigenpair, TidalMonitor, DEFAULT_TIDES } from '../src/physics/tides';
import { DEFAULT_PHYSICS, type Body } from '../src/physics/types';
import { EARTH_MASS, EARTH_RADIUS } from '../src/physics/parameters';
const planet: Body = {
  id: 'p',
  name: 'p',
  kind: 'planet',
  mass: EARTH_MASS,
  radius: EARTH_RADIUS,
  color: '#fff',
  position: [0, 0, 0],
  velocity: [0, 0, 0],
};
const star = (id: string, x: number, y = 0, mass = 1): Body => ({
  id,
  name: id,
  kind: 'star',
  mass,
  radius: 0.00465,
  color: '#fff',
  position: [x, y, 0],
  velocity: [0, 0, 0],
});
const config = { ...DEFAULT_PHYSICS, softening: 0 };
describe('multi-star tidal tensor and persistent structural failure', () => {
  it('matches the analytic 2GM/r³ eigenvalue and terrestrial density', () => {
    const r = tidalField(planet, [star('a', 0.01)], config);
    expect(r.lambda).toBeCloseTo(2 / 0.01 ** 3, 4);
    expect(r.density).toBeGreaterThan(5500);
    expect(r.density).toBeLessThan(5530);
    expect(r.dominantStarId).toBe('a');
  });
  it('is rotationally invariant and includes constructive/cancelling tensor terms', () => {
    const a = tidalField(planet, [star('a', 1)], config),
      rotated = tidalField(planet, [star('a', Math.SQRT1_2, Math.SQRT1_2)], config);
    expect(rotated.lambda).toBeCloseTo(a.lambda, 12);
    expect(tidalField(planet, [star('a', 1), star('b', -1)], config).lambda).toBeCloseTo(
      a.lambda * 2,
      12,
    );
    expect(tidalField(planet, [star('a', 1), star('b', 0, 1)], config).lambda).toBeCloseTo(
      a.lambda / 2,
      12,
    );
    expect(principalEigenpair([-5, 0, 0, 0, 2, 0, 0, 0, 3]).value).toBe(3);
  });
  it('does not confuse large common acceleration with a large tidal gradient', () => {
    expect(tidalField(planet, [star('far', 1e6, 0, 1e18)], config).ratio).toBeLessThan(1e-5);
  });
  it('follows Roche density scaling and a strength-dependent threshold', () => {
    const radius = 2.44 * planet.radius * (1 / planet.mass) ** (1 / 3),
      fluid = { ...DEFAULT_TIDES, strengthPa: 0 };
    const limit = tidalField(planet, [star('a', radius)], config, fluid);
    expect(limit.ratio).toBeCloseTo(limit.threshold, 10);
    const denser = { ...planet, mass: planet.mass * 2 };
    expect(tidalField(denser, [star('a', radius)], config, fluid).ratio).toBeCloseTo(
      limit.ratio / 2,
      12,
    );
    expect(
      tidalField(planet, [star('a', radius)], config, { ...fluid, strengthPa: 1e11 }).threshold,
    ).toBeGreaterThan(limit.threshold);
  });
  it('requires multiple sustained samples and clears a one-step spike', () => {
    const monitor = new TidalMonitor(),
      high = tidalField(planet, [star('a', 0.006)], config),
      low = tidalField(planet, [star('a', 1)], config);
    expect(monitor.sample(high, high.responseTime * 10)).toBe(false);
    expect(monitor.sample(low, high.responseTime)).toBe(false);
    expect(monitor.exposure).toBe(0);
    expect(monitor.sample(high, high.responseTime)).toBe(false);
    expect(monitor.sample(high, high.responseTime)).toBe(false);
    expect(monitor.sample(high, high.responseTime)).toBe(true);
  });
});
import { SimulationEngine } from '../src/simulation/SimulationEngine';
it('records tidal destruction time and responsible star, then restarts from prepared initial data', () => {
  const initial = [star('sun', 0.0065), structuredClone(planet)];
  initial[1]!.velocity = [0, Math.sqrt(1 / 0.0065), 0];
  const engine = new SimulationEngine('tidal-test', {
    initialBodies: initial,
    restartProvider: () => [
      star('sun', 0),
      { ...structuredClone(planet), position: [1, 0, 0], velocity: [0, 1, 0] },
    ],
  });
  engine.advance(0.25);
  const ended = engine.snapshot();
  expect(ended.reason?.type).toBe('tidal');
  expect(ended.reason?.dominantStarId).toBe('sun');
  expect(ended.reason?.year).toBeGreaterThan(0);
  expect(ended.events[0]?.reason?.tidalRatio).toBeGreaterThan(ended.tidal!.threshold);
  for (let i = 0; i < 201; i++) engine.advance(0.01);
  expect(engine.snapshot().restartCount).toBe(1);
  expect(engine.snapshot().seed).not.toBe('tidal-test');
  expect(engine.snapshot().events.some((e) => e.reason?.type === 'tidal')).toBe(true);
});
