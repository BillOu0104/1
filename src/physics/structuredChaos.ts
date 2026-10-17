/** Historical V0.2 experiment. Not imported by the V0.2.1 app/Worker; retained for offline comparisons. */
import type { Body, InitialConditionGenerator, PhysicsConfig, Vec3 } from './types';
import { DEFAULT_MASSES, EARTH_MASS, EARTH_RADIUS, stellarProperties } from './parameters';
import { seededRandom } from './random';
import { add, centerOfMass, cross, length, scale, sub } from './vector';
import { invariants, kineticEnergy } from './diagnostics';
import { totalEnergy } from './gravity';
export function removeDrift(bodies: Body[]): void {
  const c = centerOfMass(bodies),
    v = centerOfMass(bodies, 'velocity');
  for (const b of bodies) {
    b.position = sub(b.position, c);
    b.velocity = sub(b.velocity, v);
  }
}
export function acceptableChaos(bodies: readonly Body[], config: PhysicsConfig): boolean {
  const stars = bodies.filter((b) => b.kind === 'star'),
    d: number[] = [];
  for (let i = 0; i < stars.length; i++)
    for (let j = i + 1; j < stars.length; j++)
      d.push(length(sub(stars[i]!.position, stars[j]!.position)));
  const initial = invariants(stars, config),
    mass = initial.mass;
  const spin =
    (length(initial.angularMomentum) * Math.sqrt(Math.abs(initial.energy))) /
    (config.gravitationalConstant * mass ** 2.5);
  return (
    initial.energy < 0 &&
    Math.min(...d) > 1 &&
    Math.max(...d) / Math.min(...d) < 2.5 &&
    spin > 0.025 &&
    spin < 0.24
  );
}
export class StructuredChaosInitializer implements InitialConditionGenerator {
  readonly mode = 'structuredChaos';
  constructor(readonly masses: readonly number[] = DEFAULT_MASSES) {}
  generate(seed: string, config: PhysicsConfig): Body[] {
    const random = seededRandom(`chaos-v2:${seed}`),
      range = (a: number, b: number) => a + random() * (b - a);
    let stars: Body[] = [];
    for (let attempt = 0; attempt < 32; attempt++) {
      const normal: Vec3 = [range(-1, 1), range(0.4, 1), range(-1, 1)],
        unit = scale(normal, 1 / length(normal));
      stars = Array.from({ length: 3 }, (_, i) => {
        const angle = (i * 2 * Math.PI) / 3 + range(-0.55, 0.55),
          r = range(1.6, 2.8);
        const position: Vec3 = [r * Math.cos(angle), range(-0.9, 0.9), r * Math.sin(angle)];
        const mass = this.masses[i]! * range(0.97, 1.03);
        // Common randomized spin axis + turbulent/radial terms constrain L without fixing any orbit.
        const velocity = add(scale(cross(unit, position), range(0.22, 0.4)), [
          range(-0.25, 0.25),
          range(-0.18, 0.18),
          range(-0.25, 0.25),
        ]);
        return {
          id: `star-${i}`,
          name: `恒星 ${['A', 'B', 'C'][i]}`,
          kind: 'star',
          mass,
          ...stellarProperties(mass),
          position,
          velocity,
        };
      });
      removeDrift(stars);
      const k = kineticEnergy(stars),
        u = totalEnergy(stars, config) - k,
        factor = Math.sqrt((range(0.37, 0.54) * Math.abs(u)) / Math.max(k, 1e-20));
      stars.forEach((b) => {
        b.velocity = scale(b.velocity, factor);
      });
      if (acceptableChaos(stars, config)) break;
    }
    const host = stars[Math.floor(random() * 3)]!,
      angle = range(0, 2 * Math.PI),
      r = range(0.65, 1.05);
    const speed = Math.sqrt((config.gravitationalConstant * host.mass) / r) * range(0.88, 1.03);
    stars.push({
      id: 'planet',
      name: '行星 01 · PEREGRINE',
      kind: 'planet',
      mass: EARTH_MASS,
      radius: EARTH_RADIUS,
      color: '#76c9d5',
      position: add(host.position, [r * Math.cos(angle), range(-0.04, 0.04), r * Math.sin(angle)]),
      velocity: add(host.velocity, [
        -speed * Math.sin(angle),
        range(-0.08, 0.08),
        speed * Math.cos(angle),
      ]),
    });
    removeDrift(stars);
    return stars;
  }
}
