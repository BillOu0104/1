import type { Body, PhysicsConfig } from './types';
import { AU_METERS, SOLAR_MASS_KG } from './parameters';

/** Confirmed project.json controls. Values stay in the original numerical units. */
export interface GravityCageConfig {
  enabled: boolean;
  mass: number;
  k1: number;
  re: number;
  k2: number;
  rc: number;
  exponent: number;
  hard: boolean;
  hardRadius: number;
}
export const CAGE_PARAMETER_RULES = {
  mass: { min: 100000, max: 100000000, step: 0.001, default: 15000000 },
  k1: { min: 0, max: 1, step: 0.001, default: 0 },
  re: { min: 0.01, max: 0.2, step: 0.001, default: 0.1 },
  k2: { min: 0, max: 10, step: 0.001, default: 0.5 },
  rc: { min: 0, max: 6, step: 0.001, default: 0.2 },
  exponent: { min: 1, max: 10, step: 0.001, default: 2 },
  hardRadius: { min: 2.1, max: 10, step: 0.001, default: 2.1 },
} as const;
export const DEFAULT_CAGE: Readonly<GravityCageConfig> = Object.freeze({
  enabled: true,
  hard: false,
  ...Object.fromEntries(
    Object.entries(CAGE_PARAMETER_RULES).map(([key, rule]) => [key, rule.default]),
  ),
} as GravityCageConfig);
export const CAGE_LENGTH_AU = 1e12 / AU_METERS;
export const CAGE_MASS_SOLAR = 2e23 / SOLAR_MASS_KG;
/** Explicit V0.3 regularization in original dimensionless radius; original branches away from it. */
export const CAGE_TRANSITION = 0.001;
export function validateCage(cage: GravityCageConfig): void {
  if (
    typeof cage.enabled !== 'boolean' ||
    typeof cage.hard !== 'boolean' ||
    Object.entries(CAGE_PARAMETER_RULES).some(([key, rule]) => {
      const value = cage[key as keyof typeof CAGE_PARAMETER_RULES];
      return !Number.isFinite(value) || value < rule.min || value > rule.max;
    })
  )
    throw new Error('Invalid gravity cage parameters');
}
const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (10 + x * (-15 + 6 * x));
};
function outerShape(x: number, cage: GravityCageConfig): number {
  const delta = Math.max(0, x - cage.rc);
  if (!cage.hard) return cage.k2 * delta ** cage.exponent;
  // Preserve rc>Rc neutral-branch priority. Smooth its actual transition, not an imagined wall.
  const wall = Math.max(cage.rc, cage.hardRadius);
  const inside =
    cage.rc >= cage.hardRadius
      ? 0
      : (cage.k2 * delta) / Math.sqrt(Math.max(cage.hardRadius ** 2 - delta ** 2, 1e-5));
  if (x < wall - CAGE_TRANSITION) return inside;
  if (x > wall + CAGE_TRANSITION) return 100 * cage.k2;
  const t = smooth((x - wall + CAGE_TRANSITION) / (2 * CAGE_TRANSITION));
  return inside * (1 - t) + 100 * cage.k2 * t;
}
/** Signed inward amplitude with G*Mc/L² factored out. No body mass or orbit corrections. */
export function cageShape(x: number, cage: GravityCageConfig): number {
  if (!cage.enabled || x === 0) return 0;
  const width = Math.min(CAGE_TRANSITION, cage.re * 0.1);
  const inner = -cage.k1 * (1 - Math.min(x / cage.re, 1) ** 2) ** 2 * smooth(x / width);
  if (x < cage.re - width) return inner;
  const outer = outerShape(x, cage);
  if (x > cage.re + width) return outer;
  const t = smooth((x - cage.re + width) / (2 * width));
  return inner * (1 - t) + outer * t;
}
export function cageConfines(config: PhysicsConfig): boolean {
  return !!config.cage?.enabled && config.cage.k2 > 0;
}
/** Stage-local COM, not a stale Body snapshot. Optional last four state entries integrate
 * external work and impulse with the SAME DOPRI stages/error estimator as positions.
 */
export function addCageDerivative(
  state: Float64Array,
  out: Float64Array,
  bodies: readonly Body[],
  config: PhysicsConfig,
): void {
  const cage = config.cage;
  if (!cage?.enabled) return;
  let mass = 0,
    cx = 0,
    cy = 0,
    cz = 0;
  for (let i = 0; i < bodies.length; i++) {
    const m = bodies[i]!.mass;
    mass += m;
    cx += m * state[i * 6]!;
    cy += m * state[i * 6 + 1]!;
    cz += m * state[i * 6 + 2]!;
  }
  if (!(mass > 0)) return;
  cx /= mass;
  cy /= mass;
  cz /= mass;
  const unit = CAGE_LENGTH_AU * (config.galaxyScale ?? 1);
  const base = (config.gravitationalConstant * cage.mass * CAGE_MASS_SOLAR) / (unit * unit);
  const extra = bodies.length * 6;
  for (let i = 0; i < bodies.length; i++) {
    const m = bodies[i]!.mass;
    if (m <= 0) continue;
    const offset = i * 6,
      dx = state[offset]! - cx,
      dy = state[offset + 1]! - cy,
      dz = state[offset + 2]! - cz;
    const r = Math.hypot(dx, dy, dz);
    if (r === 0) continue;
    const factor = (-base * cageShape(r / unit, cage)) / r;
    const ax = factor * dx,
      ay = factor * dy,
      az = factor * dz;
    out[offset + 3]! += ax;
    out[offset + 4]! += ay;
    out[offset + 5]! += az;
    if (out.length >= extra + 4) {
      out[extra]! +=
        m * (state[offset + 3]! * ax + state[offset + 4]! * ay + state[offset + 5]! * az);
      out[extra + 1]! += m * ax;
      out[extra + 2]! += m * ay;
      out[extra + 3]! += m * az;
    }
  }
}

/** Additional field time scales, including the regularized hard boundary. Never replaces the
 * existing pairwise gravity/crossing limits. Distances are measured in the stage's COM frame. */
export function cageStepLimit(
  bodies: readonly Body[],
  config: PhysicsConfig,
  safety = 0.12,
): number {
  const cage = config.cage;
  if (!cage?.enabled || (cage.k1 === 0 && cage.k2 === 0)) return Infinity;
  let mass = 0,
    cx = 0,
    cy = 0,
    cz = 0,
    vx = 0,
    vy = 0,
    vz = 0;
  for (const b of bodies) {
    mass += b.mass;
    cx += b.mass * b.position[0];
    cy += b.mass * b.position[1];
    cz += b.mass * b.position[2];
    vx += b.mass * b.velocity[0];
    vy += b.mass * b.velocity[1];
    vz += b.mass * b.velocity[2];
  }
  cx /= mass;
  cy /= mass;
  cz /= mass;
  vx /= mass;
  vy /= mass;
  vz /= mass;
  const unit = CAGE_LENGTH_AU * (config.galaxyScale ?? 1),
    width = unit * CAGE_TRANSITION;
  const base = (config.gravitationalConstant * cage.mass * CAGE_MASS_SOLAR) / unit ** 2;
  let limit = Infinity;
  for (const b of bodies) {
    const r = Math.hypot(b.position[0] - cx, b.position[1] - cy, b.position[2] - cz);
    const speed = Math.hypot(b.velocity[0] - vx, b.velocity[1] - vy, b.velocity[2] - vz);
    const a = Math.abs(base * cageShape(r / unit, cage));
    const gradientLength =
      !cage.hard && r / unit > cage.rc ? (unit * (r / unit - cage.rc)) / cage.exponent : r;
    if (a > 0)
      limit = Math.min(limit, safety * Math.sqrt(Math.max(width, Math.min(r, gradientLength)) / a));
    if (cage.hard && cage.k2 > 0)
      limit = Math.min(
        limit,
        (safety * Math.max(width, Math.abs(r - unit * Math.max(cage.rc, cage.hardRadius)))) /
          Math.max(speed, 1e-20),
      );
    if (cage.k1 > 0 || cage.rc < cage.re)
      limit = Math.min(
        limit,
        (safety * Math.max(width, Math.abs(r - unit * cage.re))) / Math.max(speed, 1e-20),
      );
  }
  return limit;
}
