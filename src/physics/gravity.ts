import type { Body, PhysicsConfig, Vec3 } from './types';
import { add, dot, scale, sub } from './vector';
/** Pairwise softened Newtonian force. Equal/opposite impulses preserve momentum. */
export function accelerations(bodies: readonly Body[], config: PhysicsConfig): Vec3[] {
  const result: Vec3[] = bodies.map(() => [0, 0, 0]);
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!,
        b = bodies[j]!;
      const delta = sub(b.position, a.position);
      const r2 = Math.max(dot(delta, delta) + config.softening ** 2, 1e-20);
      const force = scale(delta, config.gravitationalConstant / (r2 * Math.sqrt(r2)));
      result[i] = add(result[i]!, scale(force, b.mass));
      result[j] = add(result[j]!, scale(force, -a.mass));
    }
  return result;
}
export function totalEnergy(bodies: readonly Body[], config: PhysicsConfig): number {
  let energy = bodies.reduce((sum, b) => sum + 0.5 * b.mass * dot(b.velocity, b.velocity), 0);
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!,
        b = bodies[j]!,
        delta = sub(a.position, b.position);
      energy -=
        (config.gravitationalConstant * a.mass * b.mass) /
        Math.sqrt(Math.max(dot(delta, delta) + config.softening ** 2, 1e-20));
    }
  return energy;
}
