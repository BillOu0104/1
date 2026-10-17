import { describe, expect, it } from 'vitest';
import { accelerations, totalEnergy } from '../src/physics/gravity';
import { VelocityVerlet } from '../src/physics/velocityVerlet';
import { RandomInitializer } from '../src/physics/initialConditions';
import { DEFAULT_PHYSICS, type Body } from '../src/physics/types';
import { centerOfMass, length, sub } from '../src/physics/vector';
import { detectCollision, escapeCandidates } from '../src/physics/detection';
const config = { ...DEFAULT_PHYSICS, softening: 0 };
function body(id: string, x: number, mass = 1): Body {
  return {
    id,
    name: id,
    kind: 'star',
    mass,
    radius: 0.01,
    color: '#fff',
    position: [x, 0, 0],
    velocity: [0, 0, 0],
  };
}
describe('Newtonian gravity and Velocity Verlet', () => {
  it('computes inverse-square accelerations and equal/opposite forces', () => {
    const bodies = [body('a', 0, 2), body('b', 2, 3)],
      a = accelerations(bodies, config);
    expect(a[0]![0]).toBeCloseTo(3 / 4, 12);
    expect(a[1]![0]).toBeCloseTo(-2 / 4, 12);
    expect(a[0]![0] * 2 + a[1]![0] * 3).toBeCloseTo(0, 12);
  });
  it('keeps a circular two-body orbit and bounded energy over twenty periods', () => {
    const bodies = [body('a', -0.5), body('b', 0.5)],
      v = Math.sqrt(0.5);
    bodies[0]!.velocity = [0, -v, 0];
    bodies[1]!.velocity = [0, v, 0];
    const initial = totalEnergy(bodies, config),
      verlet = new VelocityVerlet();
    const period = (2 * Math.PI) / Math.sqrt(2),
      dt = period / 2000;
    let maxError = 0;
    for (let i = 0; i < 40000; i++) {
      verlet.step(bodies, dt, config);
      maxError = Math.max(maxError, Math.abs((totalEnergy(bodies, config) - initial) / initial));
    }
    expect(maxError).toBeLessThan(1e-7);
    expect(length(sub(bodies[0]!.position, [-0.5, 0, 0]))).toBeLessThan(0.001);
    expect(length(centerOfMass(bodies))).toBeLessThan(1e-10);
  });
  it('is time reversible and exhibits second-order convergence', () => {
    const run = (dt: number) => {
      const b = body('probe', 1, 1e-10),
        sun = body('sun', 0);
      b.velocity = [0, 1, 0];
      const integrator = new VelocityVerlet(),
        bodies = [sun, b];
      for (let i = 0; i < Math.round(1 / dt); i++) integrator.step(bodies, dt, config);
      return length(sub(b.position, [Math.cos(1), Math.sin(1), 0]));
    };
    expect(run(0.01) / run(0.005)).toBeGreaterThan(3.8);
    const b = [body('a', -1), body('b', 1)],
      integrator = new VelocityVerlet();
    b[0]!.velocity = [0, 0.3, 0.1];
    b[1]!.velocity = [0, -0.3, -0.1];
    const before = structuredClone(b);
    for (let i = 0; i < 1000; i++) integrator.step(b, 0.002, config);
    for (let i = 0; i < 1000; i++) integrator.step(b, -0.002, config);
    expect(length(sub(b[0]!.position, before[0]!.position))).toBeLessThan(1e-10);
  });
  it('protects coincident positions from NaN/Infinity', () => {
    const bodies = [body('a', 0), body('b', 0)];
    new VelocityVerlet().step(bodies, 0.002, { ...config, softening: 0 });
    expect(bodies.every((b) => [...b.position, ...b.velocity].every(Number.isFinite))).toBe(true);
  });
});
describe('Random initializer', () => {
  it('reproduces seeds, produces four valid 3D bodies and removes center drift', () => {
    const generator = new RandomInitializer(),
      a = generator.generate('恒星-42', DEFAULT_PHYSICS);
    expect(a).toEqual(generator.generate('恒星-42', DEFAULT_PHYSICS));
    expect(a).not.toEqual(generator.generate('different', DEFAULT_PHYSICS));
    expect(a.filter((b) => b.kind === 'star')).toHaveLength(3);
    expect(a).toHaveLength(4);
    expect(length(centerOfMass(a))).toBeLessThan(1e-12);
    expect(length(centerOfMass(a, 'velocity'))).toBeLessThan(1e-12);
    expect(detectCollision(a)).toBeNull();
    expect(totalEnergy(a, DEFAULT_PHYSICS)).toBeLessThan(0);
    expect(a.some((b) => Math.abs(b.position[1]) > 0.01)).toBe(true);
  });
  it('avoids initial collisions and non-finite values across 200 seeds', () => {
    for (let i = 0; i < 200; i++) {
      const bodies = new RandomInitializer().generate(String(i), DEFAULT_PHYSICS);
      expect(detectCollision(bodies)).toBeNull();
      expect(
        bodies.every((b) => [b.mass, ...b.position, ...b.velocity].every(Number.isFinite)),
      ).toBe(true);
    }
  });
});
describe('termination detection', () => {
  it('detects collisions across a full fixed step, including tunneling', () => {
    const a = body('a', 1),
      b = body('b', -1);
    expect(
      detectCollision(
        [a, b],
        [
          [-1, 0, 0],
          [1, 0, 0],
        ],
      )?.type,
    ).toBe('collision');
  });
  it('requires distance, outward velocity and unbound energy for escape', () => {
    const a = body('host', 0),
      b = body('traveler', 200, 1e-6);
    b.velocity = [-1, 0, 0];
    expect(escapeCandidates([a, b], DEFAULT_PHYSICS)).not.toContain('traveler');
    b.velocity = [0.01, 0.05, 0];
    expect(escapeCandidates([a, b], DEFAULT_PHYSICS)).not.toContain('traveler');
    b.velocity = [1, 0, 0];
    expect(escapeCandidates([a, b], DEFAULT_PHYSICS)).toContain('traveler');
    b.position = [10, 0, 0];
    expect(escapeCandidates([a, b], DEFAULT_PHYSICS)).not.toContain('traveler');
  });
});
