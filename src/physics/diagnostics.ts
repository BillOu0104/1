import type { Body, PhysicsConfig, Vec3 } from './types';
import { add, centerOfMass, cross, dot, length, scale, sub } from './vector';
import { totalEnergy } from './gravity';
export interface Invariants {
  energy: number;
  momentum: Vec3;
  angularMomentum: Vec3;
  mass: number;
  momentumScale: number;
  angularScale: number;
}
export function invariants(bodies: readonly Body[], config: PhysicsConfig): Invariants {
  const center = centerOfMass(bodies),
    drift = centerOfMass(bodies, 'velocity');
  let momentum: Vec3 = [0, 0, 0],
    angularMomentum: Vec3 = [0, 0, 0],
    momentumScale = 0,
    angularScale = 0;
  for (const b of bodies) {
    momentum = add(momentum, scale(b.velocity, b.mass));
    const r = sub(b.position, center),
      v = sub(b.velocity, drift);
    angularMomentum = add(angularMomentum, scale(cross(r, v), b.mass));
    momentumScale += b.mass * length(v);
    angularScale += b.mass * length(r) * length(v);
  }
  return {
    energy: totalEnergy(bodies, config),
    momentum,
    angularMomentum,
    mass: bodies.reduce((s, b) => s + b.mass, 0),
    momentumScale,
    angularScale,
  };
}
export function errors(initial: Invariants, bodies: readonly Body[], config: PhysicsConfig) {
  const now = invariants(bodies, config);
  return {
    energy: (now.energy - initial.energy) / Math.max(Math.abs(initial.energy), 1e-15),
    momentum: length(sub(now.momentum, initial.momentum)) / Math.max(initial.momentumScale, 1e-15),
    angularMomentum:
      length(sub(now.angularMomentum, initial.angularMomentum)) /
      Math.max(length(initial.angularMomentum), initial.angularScale * 1e-8, 1e-15),
  };
}
export class EncounterTracker {
  count = 0;
  exchanges = 0;
  variation = 0;
  private inside = new Set<string>();
  private nearest = new Map<string, string>();
  private distances = new Map<string, number>();
  update(bodies: readonly Body[], threshold = 1): void {
    const stars = bodies.filter((b) => b.kind === 'star');
    for (let i = 0; i < stars.length; i++) {
      let nearest = '',
        distance = Infinity;
      for (let j = 0; j < stars.length; j++)
        if (i !== j) {
          const d = length(sub(stars[i]!.position, stars[j]!.position));
          if (d < distance) {
            distance = d;
            nearest = stars[j]!.id;
          }
          if (j > i) {
            const key = `${i}:${j}`,
              last = this.distances.get(key);
            if (last !== undefined) this.variation += Math.abs(Math.log(d / last));
            this.distances.set(key, d);
            if (d < threshold && !this.inside.has(key)) {
              this.count++;
              this.inside.add(key);
            }
            if (d > threshold * 1.3) this.inside.delete(key);
          }
        }
      const last = this.nearest.get(stars[i]!.id);
      if (last && last !== nearest) this.exchanges++;
      this.nearest.set(stars[i]!.id, nearest);
    }
  }
}
export function kineticEnergy(bodies: readonly Body[]): number {
  return bodies.reduce((s, b) => s + 0.5 * b.mass * dot(b.velocity, b.velocity), 0);
}
