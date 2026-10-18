import { expect, it, vi } from 'vitest';
import { RandomInitializer } from '../src/physics/initialConditions';
import * as random from '../src/physics/random';
import { DEFAULT_PHYSICS } from '../src/physics/types';
import { centerOfMass, length, sub } from '../src/physics/vector';
import { totalEnergy, accelerations } from '../src/physics/gravity';
import { readPlanetTides } from '../src/physics/tides';
import { invariants } from '../src/physics/diagnostics';
it('samples all four bodies randomly with bound stars, angular momentum and safe planetary starts', () => {
  const nearest = [0, 0, 0];
  const generator = new RandomInitializer();
  let outOfPlane = 0;
  for (let i = 0; i < 500; i++) {
    const bodies = generator.generate(`v03-${i}`, DEFAULT_PHYSICS),
      stars = bodies.slice(0, 3),
      planet = bodies[3]!;
    expect(totalEnergy(stars, DEFAULT_PHYSICS)).toBeLessThan(0);
    const invariant = invariants(stars, DEFAULT_PHYSICS);
    expect(length(invariant.angularMomentum) / invariant.angularScale).toBeGreaterThan(0.599);
    expect(length(centerOfMass(bodies))).toBeLessThan(1e-12);
    expect(length(centerOfMass(bodies, 'velocity'))).toBeLessThan(1e-12);
    const d = stars.map((s) => length(sub(s.position, planet.position))),
      closest = d.indexOf(Math.min(...d));
    nearest[closest]!++;
    expect(Math.min(...d)).toBeGreaterThan(1.199);
    const tides = readPlanetTides(bodies, DEFAULT_PHYSICS)!;
    expect(tides.ratio).toBeLessThan(tides.threshold * 0.1);
    if (bodies.every((b) => Math.abs(b.position[2]) > 0.01 && Math.abs(b.velocity[2]) > 0.001))
      outOfPlane++;
  }
  expect(Math.min(...nearest)).toBeGreaterThan(100);
  expect(outOfPlane).toBeGreaterThan(350);
});
it('reproduces seed+mass settings and uses exact similarity with unchanged physical radii/time units', () => {
  const generator = new RandomInitializer([1.1, 0.94, 0.12]);
  const a = generator.generate('scale', DEFAULT_PHYSICS),
    b = generator.generate('scale', { ...DEFAULT_PHYSICS, galaxyScale: 5 });
  expect(a).toEqual(generator.generate('scale', DEFAULT_PHYSICS));
  expect(a).not.toEqual(generator.generate('other', DEFAULT_PHYSICS));
  for (let i = 0; i < 4; i++) {
    expect(b[i]!.mass).toBe(a[i]!.mass);
    expect(b[i]!.radius).toBe(a[i]!.radius);
    for (let k = 0; k < 3; k++) {
      expect(b[i]!.position[k]).toBe(a[i]!.position[k]! * 5);
      expect(b[i]!.velocity[k]).toBeCloseTo(a[i]!.velocity[k]! / Math.sqrt(5), 15);
    }
  }
  const fa = accelerations(a, DEFAULT_PHYSICS),
    fb = accelerations(b, DEFAULT_PHYSICS);
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 3; k++) expect(fb[i]![k]).toBeCloseTo(fa[i]![k]! / 25, 10);
});
it('has bounded rejection, never silently substituting a fixed orbit or seed', () => {
  const spy = vi.spyOn(random, 'seededRandom').mockReturnValue(() => 0.5);
  try {
    expect(() => new RandomInitializer().generate('degenerate', DEFAULT_PHYSICS)).toThrow(
      '128 attempts',
    );
  } finally {
    spy.mockRestore();
  }
});
it('supports unequal and extreme existing stellar reference mass settings without preview screening', () => {
  for (const masses of [
    [0.08, 3, 3],
    [3, 0.08, 0.08],
    [0.08, 0.08, 3],
    [3, 3, 0.08],
    [1.1, 0.94, 0.12],
    [0.08, 0.08, 0.08],
    [3, 3, 3],
  ])
    for (let seed = 0; seed < 100; seed++) {
      const bodies = new RandomInitializer(masses).generate(`mass-range-${seed}`, DEFAULT_PHYSICS);
      for (let i = 0; i < 3; i++) expect(bodies[i]!.mass / masses[i]!).toBeGreaterThanOrEqual(0.97);
    }
});
