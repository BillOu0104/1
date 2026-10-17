import type { Body, Vec3 } from './types';
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3) => Math.hypot(...a);
export function centerOfMass(
  bodies: readonly Body[],
  field: 'position' | 'velocity' = 'position',
): Vec3 {
  let mass = 0;
  let center: Vec3 = [0, 0, 0];
  for (const b of bodies) {
    mass += b.mass;
    center = add(center, scale(b[field], b.mass));
  }
  return mass > 0 ? scale(center, 1 / mass) : center;
}
