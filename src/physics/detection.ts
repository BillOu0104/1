import type { Body, PhysicsConfig, Vec3 } from './types';
import { centerOfMass, dot, length, scale, sub, add } from './vector';
export type EndReason = {
  type: 'collision' | 'escape' | 'numerical';
  message: string;
  bodyIds: string[];
};
export function isValidSystem(bodies: readonly Body[]): boolean {
  return (
    bodies.length > 0 &&
    bodies.every(
      (b) =>
        b.mass > 0 &&
        b.radius > 0 &&
        [b.mass, b.radius, ...b.position, ...b.velocity].every(Number.isFinite),
    )
  );
}
export function detectCollision(
  bodies: readonly Body[],
  previous?: readonly Vec3[],
): EndReason | null {
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!,
        b = bodies[j]!,
        current = sub(a.position, b.position);
      let nearest = current;
      if (previous) {
        const start = sub(previous[i]!, previous[j]!),
          motion = sub(current, start);
        const t = Math.max(
          0,
          Math.min(1, -dot(start, motion) / Math.max(dot(motion, motion), 1e-30)),
        );
        nearest = add(start, scale(motion, t));
      }
      if (length(nearest) <= a.radius + b.radius)
        return { type: 'collision', message: `${a.name} 与 ${b.name} 碰撞`, bodyIds: [a.id, b.id] };
    }
  return null;
}
/** Relative to all OTHER bodies: distance + outward motion + positive specific orbital energy. */
export function escapeCandidates(bodies: readonly Body[], config: PhysicsConfig): string[] {
  return bodies
    .filter((body) => {
      const others = bodies.filter((b) => b !== body),
        mass = others.reduce((s, b) => s + b.mass, 0);
      const r = sub(body.position, centerOfMass(others)),
        v = sub(body.velocity, centerOfMass(others, 'velocity'));
      const potential = others.reduce(
        (s, b) =>
          s -
          (config.gravitationalConstant * b.mass) /
            Math.sqrt(length(sub(body.position, b.position)) ** 2 + config.softening ** 2),
        0,
      );
      // Include relative two-cluster kinetic energy correction for a massive escaping star.
      const energy = (0.5 * dot(v, v) * mass) / (mass + body.mass) + potential;
      return length(r) > config.escapeDistance && dot(r, v) > 0 && energy > 0;
    })
    .map((b) => b.id);
}
