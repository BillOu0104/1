import { describe, expect, it } from 'vitest';
import {
  OriginalRandomInitializer,
  ORIGINAL_LENGTH_AU,
  ORIGINAL_MASS_SOLAR,
  ORIGINAL_VELOCITY,
} from '../src/physics/originalInitializer';
import { V04_DEFAULTS } from '../src/environment/config';
import { seededRandom } from '../src/physics/random';
import { DEFAULT_PHYSICS } from '../src/physics/types';
import { centerOfMass } from '../src/physics/vector';
describe('documented original initializer', () => {
  it('uses exactly 12 position draws then 12 velocity draws, no drift correction or mass jitter', () => {
    const c = { ...V04_DEFAULTS },
      b = new OriginalRandomInitializer([1.1, 0.94, 0.12], c).generate('original', DEFAULT_PHYSICS),
      random = seededRandom('original');
    for (const body of b)
      for (const x of body.position)
        expect(x).toBeCloseTo((random() - 0.5) * c.randomPosRange * ORIGINAL_LENGTH_AU, 14);
    for (const body of b)
      for (const x of body.velocity)
        expect(x).toBeCloseTo((random() - 0.5) * c.randomSpeedRange * ORIGINAL_VELOCITY, 14);
    expect(b.map((x) => x.mass)).toEqual([1.1, 0.94, 0.12, 5000 * ORIGINAL_MASS_SOLAR]);
    expect(centerOfMass(b, 'velocity')).not.toEqual([0, 0, 0]);
  });
  it('reproduces a Seed and changes all four 3D initial states with a different Seed', () => {
    const g = new OriginalRandomInitializer(),
      a = g.generate('a', DEFAULT_PHYSICS);
    expect(g.generate('a', DEFAULT_PHYSICS)).toEqual(a);
    g.generate('b', DEFAULT_PHYSICS).forEach((b, i) => {
      expect(b.position).not.toEqual(a[i]!.position);
      expect(b.velocity).not.toEqual(a[i]!.velocity);
    });
  });
  it('applies galaxy similarity after original unit conversion and keeps masses and radii', () => {
    const g = new OriginalRandomInitializer(),
      a = g.generate('scales', DEFAULT_PHYSICS),
      b = g.generate('scales', { ...DEFAULT_PHYSICS, galaxyScale: 5 });
    b.forEach((body, i) => {
      body.position.forEach((v, j) => expect(v).toBeCloseTo(a[i]!.position[j]! * 5, 13));
      body.velocity.forEach((v, j) => expect(v).toBeCloseTo(a[i]!.velocity[j]! / Math.sqrt(5), 13));
      expect(body.mass).toBe(a[i]!.mass);
      expect(body.radius).toBe(a[i]!.radius);
    });
  });
  it('maps all 24 Custom Seed inputs directly, independently of PRNG Seed and random ranges', () => {
    const c = { ...V04_DEFAULTS, customInitial: true };
    const a = new OriginalRandomInitializer(undefined, c).generate('a', DEFAULT_PHYSICS);
    expect(a[0]!.position).toEqual([0, ORIGINAL_LENGTH_AU, 0]);
    expect(a[1]!.velocity).toEqual([0, -0.05 * ORIGINAL_VELOCITY, 0.1 * ORIGINAL_VELOCITY]);
    expect(
      new OriginalRandomInitializer(undefined, { ...c, randomSpeedRange: 4 }).generate(
        'b',
        DEFAULT_PHYSICS,
      ),
    ).toEqual(a);
  });
  it('rejects invalid inputs and physical overlaps with bounded work', () => {
    expect(
      () => new OriginalRandomInitializer(undefined, { ...V04_DEFAULTS, randomPosRange: 0 }),
    ).toThrow();
    expect(() =>
      new OriginalRandomInitializer(undefined, {
        ...V04_DEFAULTS,
        customInitial: true,
        initial0X: 0.05,
        initial0Y: -0.05,
      }).generate('overlap', DEFAULT_PHYSICS),
    ).toThrow(/重叠/);
    expect(() =>
      new OriginalRandomInitializer(undefined, { ...V04_DEFAULTS, randomPosRange: 0.001 }).generate(
        'tiny',
        DEFAULT_PHYSICS,
      ),
    ).toThrow(/64/);
  });
  it('matches cube component statistics across 512 reproducible Seeds, without planet-specific shell or speed', () => {
    const g = new OriginalRandomInitializer();
    let r2 = 0,
      v2 = 0;
    for (let i = 0; i < 512; i++) {
      const b = g.generate(`distribution-${i}`, DEFAULT_PHYSICS)[3]!;
      r2 += b.position.reduce((s, x) => s + (x / ORIGINAL_LENGTH_AU) ** 2, 0);
      v2 += b.velocity.reduce((s, x) => s + (x / ORIGINAL_VELOCITY) ** 2, 0);
    }
    expect(r2 / 512).toBeCloseTo(V04_DEFAULTS.randomPosRange ** 2 / 4, 1);
    expect(v2 / 512).toBeCloseTo(V04_DEFAULTS.randomSpeedRange ** 2 / 4, 3);
  });
});
