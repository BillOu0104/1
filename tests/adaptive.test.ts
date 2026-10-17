import { describe, expect, it } from 'vitest';
import { AdaptiveDopri5, dynamicalStep } from '../src/physics/adaptive';
import { DEFAULT_PHYSICS, type Body } from '../src/physics/types';
import { invariants, errors } from '../src/physics/diagnostics';
import { Yoshida4 } from '../src/physics/yoshida4';
import { VelocityVerlet } from '../src/physics/velocityVerlet';
const body = (id: string, x: number, mass = 1): Body => ({
  id,
  name: id,
  kind: 'star',
  mass,
  radius: 1e-6,
  color: '#fff',
  position: [x, 0, 0],
  velocity: [0, 0, 0],
});
const config = { ...DEFAULT_PHYSICS, softening: 0 };
describe('adaptive physical accuracy', () => {
  it('uses mass/dynamical and crossing times, not only separation', () => {
    const b = [body('a', 0), body('b', 1)],
      normal = dynamicalStep(b, config);
    b[1]!.velocity = [100, 0, 0];
    expect(dynamicalStep(b, config)).toBeLessThan(normal / 10);
    b[1]!.velocity = [0, 0, 0];
    b[1]!.mass = 1e4;
    expect(dynamicalStep(b, config)).toBeLessThan(normal / 30);
  });
  it('rejects an inaccurate proposal without mutating any body', () => {
    const b = [body('a', 0), body('b', 1)];
    b[1]!.velocity = [0, 2, 0];
    const original = structuredClone(b);
    const result = new AdaptiveDopri5({
      relativeTolerance: 1e-16,
      absoluteTolerance: 1e-18,
      safety: 1,
    }).attempt(b, 0.1, config);
    expect(result.accepted).toBe(false);
    expect(b).toEqual(original);
  });
  it('resolves a non-colliding eccentric periapsis with bounded invariant errors', () => {
    const b = [body('host', 0), body('planet', 1.99, 3e-6)];
    b[1]!.kind = 'planet';
    b[1]!.velocity = [0, Math.sqrt(0.01 / 1.99), 0];
    const initial = invariants(b, config),
      solver = new AdaptiveDopri5();
    let t = 0,
      min = Infinity,
      max = 0,
      energy = 0,
      angular = 0;
    while (t < 2 * Math.PI) {
      const r = solver.attempt(b, 2 * Math.PI - t, config);
      if (!r.accepted) continue;
      t += r.dt;
      min = Math.min(min, r.dt);
      max = Math.max(max, r.dt);
      const e = errors(initial, b, config);
      energy = Math.max(energy, Math.abs(e.energy));
      angular = Math.max(angular, e.angularMomentum);
    }
    expect(min).toBeLessThan(max / 100);
    expect(energy).toBeLessThan(1e-6);
    expect(angular).toBeLessThan(1e-7);
  });
  it('fourth-order Yoshida improves smooth-orbit energy at the same outer step', () => {
    const run = (method: VelocityVerlet | Yoshida4) => {
      const b = [body('a', -0.5), body('b', 0.5)];
      b[0]!.velocity = [0, -Math.sqrt(0.5), 0];
      b[1]!.velocity = [0, Math.sqrt(0.5), 0];
      const initial = invariants(b, config);
      let max = 0;
      for (let i = 0; i < 500; i++) {
        method.step(b, 0.02, config);
        max = Math.max(max, Math.abs(errors(initial, b, config).energy));
      }
      return max;
    };
    expect(run(new Yoshida4())).toBeLessThan(run(new VelocityVerlet()) / 100);
  });
});
import { SimulationEngine } from '../src/simulation/SimulationEngine';
it('does not turn a resolved curved grazing pass into a false chord collision', () => {
  const b = [body('host', 0), body('planet', 1.994, 3e-6)];
  b[0]!.radius = 0.00465;
  b[1]!.radius = 4.26e-5;
  b[1]!.kind = 'planet';
  b[1]!.velocity = [0, Math.sqrt(0.006 / 1.994), 0];
  const engine = new SimulationEngine('grazing', { initialBodies: b, tides: { enabled: false } });
  engine.setControls({ autoRestart: false, speed: 20 });
  for (let i = 0; i < 40; i++) engine.advance(0.05);
  expect(engine.snapshot().reason).toBeNull();
  expect(Math.abs(engine.snapshot().relativeEnergyError)).toBeLessThan(1e-5);
});
