import { V04_DEFAULTS, validateV04, type V04Settings } from '../environment/config';
import { applyGalaxyScale } from './initialConditions';
import {
  AU_METERS,
  DEFAULT_MASSES,
  EARTH_RADIUS,
  SOLAR_MASS_KG,
  TIME_UNIT_SECONDS,
  stellarProperties,
} from './parameters';
import { seededRandom } from './random';
import type { Body, InitialConditionGenerator, PhysicsConfig, Vec3 } from './types';
import { length, sub } from './vector';
export const ORIGINAL_LENGTH_AU = 1e12 / AU_METERS;
export const ORIGINAL_VELOCITY = ((1e12 / 31536000) * TIME_UNIT_SECONDS) / AU_METERS;
export const ORIGINAL_MASS_SOLAR = 2e23 / SOLAR_MASS_KG;
const AXES = ['X', 'Y', 'Z', 'VX', 'VY', 'VZ'] as const;
/** Independent reimplementation of the documented cube distribution and draw order.
 * Only reject physical overlaps, never screen lifetime/temperature or normalize orbits.
 */
export class OriginalRandomInitializer implements InitialConditionGenerator {
  readonly mode = 'random';
  constructor(
    private readonly masses: readonly number[] = DEFAULT_MASSES,
    private readonly settings: V04Settings = V04_DEFAULTS,
  ) {
    validateV04(settings);
    if (masses.length !== 3 || !masses.every((m) => Number.isFinite(m) && m >= 0.08 && m <= 3))
      throw new Error('Invalid stellar masses');
  }
  generate(seed: string, config: PhysicsConfig): Body[] {
    const s = this.settings,
      random = seededRandom(seed);
    for (let attempt = 0; attempt < 64; attempt++) {
      const bodies: Body[] = [...this.masses, s.planetMassOriginal * ORIGINAL_MASS_SOLAR].map(
        (mass, i) => ({
          id: i === 3 ? 'planet' : `star-${i}`,
          name: i === 3 ? '行星 01 · PEREGRINE' : `恒星 ${'ABC'[i]}`,
          kind: i === 3 ? 'planet' : 'star',
          mass,
          ...(i === 3 ? { radius: EARTH_RADIUS, color: '#76c9d5' } : stellarProperties(mass)),
          position: [0, 0, 0],
          velocity: [0, 0, 0],
        }),
      );
      // All positions first, then all velocities. Exactly 24 draws for an accepted first sample.
      for (const property of ['position', 'velocity'] as const) {
        for (let i = 0; i < 4; i++)
          for (let axis = 0; axis < 3; axis++) {
            const key =
              `initial${i}${AXES[axis + (property === 'velocity' ? 3 : 0)]}` as keyof V04Settings;
            const raw = s.customInitial
              ? Number(s[key])
              : (random() - 0.5) *
                (property === 'position' ? s.randomPosRange : s.randomSpeedRange);
            bodies[i]![property][axis] =
              raw * (property === 'position' ? ORIGINAL_LENGTH_AU : ORIGINAL_VELOCITY);
          }
      }
      applyGalaxyScale(bodies, config.galaxyScale ?? 1);
      const overlap = bodies.some((a, i) =>
        bodies.slice(i + 1).some((b) => length(sub(a.position, b.position)) <= a.radius + b.radius),
      );
      if (!overlap) return bodies;
      if (s.customInitial) throw new Error('Custom Seed 初始天体重叠；请修改位置');
    }
    throw new Error('Random Pos Range 无法生成不重叠天体（64 次数值检查已用尽）');
  }
}
export function customVector(settings: V04Settings, body: number, velocity = false): Vec3 {
  return AXES.slice(velocity ? 3 : 0, velocity ? 6 : 3).map((axis) =>
    Number(settings[`initial${body}${axis}` as keyof V04Settings]),
  ) as Vec3;
}
