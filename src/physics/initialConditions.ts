import { DEFAULT_MASSES, EARTH_MASS, EARTH_RADIUS, stellarProperties } from './parameters';
import type { Body, GeneratorMode, InitialConditionGenerator, PhysicsConfig, Vec3 } from './types';
import { seededRandom } from './random';
import { centerOfMass, cross, dot, length, scale, sub, add } from './vector';
import { totalEnergy } from './gravity';
import { readPlanetTides } from './tides';

export const MAX_INITIAL_ATTEMPTS = 128;
/** Newtonian similarity only: AU and physical time retain their original meaning. */
export function applyGalaxyScale(bodies: Body[], factor: number): Body[] {
  if (!Number.isFinite(factor) || factor < 1 || factor > 10)
    throw new Error('Galaxy scale must be 1–10');
  for (const body of bodies) {
    body.position = scale(body.position, factor);
    body.velocity = scale(body.velocity, 1 / Math.sqrt(factor));
  }
  return bodies;
}
function removeDrift(bodies: Body[]): void {
  const center = centerOfMass(bodies),
    drift = centerOfMass(bodies, 'velocity');
  for (const b of bodies) {
    b.position = sub(b.position, center);
    b.velocity = sub(b.velocity, drift);
  }
}
/** Independent isotropic positions and stochastic velocities. Bounded algebraic rejection only:
 * no orbit template, host star, seed catalogue, preview integration, score or candidate pool.
 */
export class RandomInitializer implements InitialConditionGenerator {
  readonly mode = 'random';
  constructor(private readonly referenceMasses: readonly number[] = DEFAULT_MASSES) {
    if (
      referenceMasses.length !== 3 ||
      !referenceMasses.every((m) => Number.isFinite(m) && m >= 0.08 && m <= 3)
    )
      throw new Error('Invalid reference masses');
  }
  generate(seed: string, config: PhysicsConfig): Body[] {
    const random = seededRandom(seed);
    const range = (a: number, b: number) => a + random() * (b - a);
    const direction = (): Vec3 => {
      const z = range(-1, 1),
        phi = range(0, 2 * Math.PI),
        r = Math.sqrt(1 - z * z);
      return [r * Math.cos(phi), r * Math.sin(phi), z];
    };
    for (let attempt = 0; attempt < MAX_INITIAL_ATTEMPTS; attempt++) {
      const bodies: Body[] = this.referenceMasses.map((reference, i) => {
        const mass = reference * range(0.97, 1.03);
        return {
          id: `star-${i}`,
          name: ['恒星 A', '恒星 B', '恒星 C'][i]!,
          kind: 'star',
          mass,
          ...stellarProperties(mass),
          position: scale(direction(), 3.2 * Math.cbrt(range(0.08, 1))),
          velocity: [0, 0, 0],
        };
      });
      removeDrift(bodies);
      const distances: number[] = [];
      for (let i = 0; i < 3; i++)
        for (let j = i + 1; j < 3; j++)
          distances.push(length(sub(bodies[i]!.position, bodies[j]!.position)));
      if (Math.min(...distances) < 1.5 || Math.max(...distances) / Math.min(...distances) > 3)
        continue;
      const axis = direction();
      for (const b of bodies)
        b.velocity = add(
          scale(cross(axis, b.position), range(0.7, 1.1)),
          scale(direction(), range(0.2, 0.65)),
        );
      removeDrift(bodies);
      const kinetic = bodies.reduce((s, b) => s + 0.5 * b.mass * dot(b.velocity, b.velocity), 0);
      const potential = totalEnergy(bodies, config) - kinetic;
      const factor = Math.sqrt(
        (range(0.45, 0.58) * Math.abs(potential)) / Math.max(kinetic, 1e-20),
      );
      for (const b of bodies) b.velocity = scale(b.velocity, factor);
      let angular: Vec3 = [0, 0, 0],
        angularScale = 0;
      for (const b of bodies) {
        angular = add(angular, scale(cross(b.position, b.velocity), b.mass));
        angularScale += b.mass * length(b.position) * length(b.velocity);
      }
      if (!(angularScale > 1e-12) || length(angular) < 0.6 * angularScale) continue;
      // Reject a star already unbound relative to the other two, without forecasting its orbit.
      if (
        bodies.some((b) => {
          const others = bodies.filter((o) => o !== b),
            mass = others.reduce((s, o) => s + o.mass, 0);
          const velocity = sub(b.velocity, centerOfMass(others, 'velocity'));
          const binding = others.reduce(
            (s, o) =>
              s +
              (config.gravitationalConstant * o.mass) /
                Math.hypot(length(sub(b.position, o.position)), config.softening),
            0,
          );
          return (0.5 * dot(velocity, velocity) * mass) / (mass + b.mass) >= binding;
        })
      )
        continue;
      const position = scale(direction(), range(3.5, 7));
      if (bodies.some((b) => length(sub(position, b.position)) < 1.2)) continue;
      let velocity = direction();
      // Random tangential bias about the whole system, never a prescribed circular host orbit.
      if (Math.abs(dot(velocity, position)) > 0.45 * length(position)) continue;
      const binding = bodies.reduce(
        (s, b) =>
          s +
          (config.gravitationalConstant * b.mass) /
            Math.hypot(length(sub(position, b.position)), config.softening),
        0,
      );
      velocity = scale(velocity, range(0.55, 0.8) * Math.sqrt(2 * binding));
      bodies.push({
        id: 'planet',
        name: '行星 01 · PEREGRINE',
        kind: 'planet',
        mass: EARTH_MASS,
        radius: EARTH_RADIUS,
        color: '#76c9d5',
        position,
        velocity,
      });
      removeDrift(bodies);
      const tides = readPlanetTides(bodies, config);
      if (tides && tides.ratio >= tides.threshold * 0.1) continue;
      return applyGalaxyScale(bodies, config.galaxyScale ?? 1);
    }
    // Explicit bounded failure; engine/Worker recovery handles it, never a hidden fixed template.
    throw new Error(`Random initialization exhausted ${MAX_INITIAL_ATTEMPTS} attempts`);
  }
}
export interface GeneratorDescriptor {
  mode: GeneratorMode;
  implemented: boolean;
  create?: () => InitialConditionGenerator;
}
export const GENERATORS: readonly GeneratorDescriptor[] = [
  { mode: 'structuredChaos', implemented: false },
  { mode: 'random', implemented: true, create: () => new RandomInitializer() },
  { mode: 'longLived', implemented: false },
  { mode: 'structuredRandom', implemented: false },
];
