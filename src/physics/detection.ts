import { cageConfines } from './cage';
import { DEFAULT_ESCAPE_POLICY, type Body, type PhysicsConfig, type Vec3 } from './types';
import { auToLightDays } from './parameters';
import { centerOfMass, dot, length, scale, sub, add } from './vector';
export type EndReason = {
  type: 'collision' | 'escape' | 'numerical' | 'tidal';
  message: string;
  bodyIds: string[];
  collisionKind?: 'stellar' | 'planetary';
  year?: number;
  dominantStarId?: string;
  tidalRatio?: number;
  escapeKind?: Body['kind'];
  escape?: EscapeEvidence;
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
        return {
          type: 'collision',
          collisionKind: a.kind === 'planet' || b.kind === 'planet' ? 'planetary' : 'stellar',
          message: `${a.name} 与 ${b.name} 碰撞`,
          bodyIds: [a.id, b.id],
        };
    }
  return null;
}
export interface EscapeEvidence {
  bodyId: string;
  tier: 'early' | 'regular';
  distanceAU: number;
  distanceLightDays: number;
  relativeSpeed: number; // AU / T₀
  radialSpeed: number;
  specificEnergy: number; // AU² / T₀², relative cluster kinetic energy per escaping mass
  energyMargin: number;
  isolation: number;
}
/** Both tiers require multi-body potential, outward separation and a resolved far field.
 * This is a conservative finite-time escape criterion, not a proof about all future N-body motion.
 */
export function readEscapeCandidates(
  bodies: readonly Body[],
  config: PhysicsConfig,
): EscapeEvidence[] {
  if (cageConfines(config)) return [];
  const policy = { ...DEFAULT_ESCAPE_POLICY, ...config.escapePolicy };
  const galaxyScale = config.galaxyScale ?? 1;
  const regularDistance = config.escapeDistance * galaxyScale;
  const earlyDistance = policy.earlyDistance * galaxyScale;
  const results: EscapeEvidence[] = [];
  for (const body of bodies) {
    const others = bodies.filter((b) => b !== body);
    const mass = others.reduce((sum, b) => sum + b.mass, 0);
    if (!(mass > 0)) continue;
    const center = centerOfMass(others),
      drift = centerOfMass(others, 'velocity');
    const r = sub(body.position, center),
      v = sub(body.velocity, drift);
    const distance = length(r),
      speed = length(v);
    if (!(distance > Math.min(earlyDistance, regularDistance)) || speed === 0) continue;
    const radial = dot(r, v) / distance;
    if (!(radial > 0)) continue;
    let potential = 0,
      extent = 0,
      moment = 0,
      separating = true;
    for (const other of others) {
      const offset = length(sub(other.position, center));
      moment += other.mass * offset ** 2;
      // A co-moving Earth-mass companion must not mask a stellar escape.
      if (other.mass >= mass * 0.01) {
        extent = Math.max(extent, offset);
        if (dot(sub(body.position, other.position), sub(body.velocity, other.velocity)) <= 0)
          separating = false;
      }
      potential -=
        (config.gravitationalConstant * other.mass) /
        Math.sqrt(length(sub(body.position, other.position)) ** 2 + config.softening ** 2);
    }
    const kinetic = (0.5 * speed ** 2 * mass) / (mass + body.mass);
    const energy = kinetic + potential;
    const margin = energy / Math.max(Math.abs(potential), 1e-30);
    const isolation = distance / Math.max(extent, Math.sqrt(moment / mass), 1e-12);
    // Estimate a conservative non-monopole allowance, not a bound on future energy exchange.
    const multipoleAllowance =
      (4 * config.gravitationalConstant * moment) /
      Math.max(distance - extent, distance * 0.01) ** 3;
    if (!separating || !(energy > multipoleAllowance)) continue;
    const early =
      distance > earlyDistance &&
      isolation >= policy.earlyIsolation &&
      margin >= policy.earlyEnergyMargin &&
      radial / speed >= policy.earlyRadialFraction;
    const regular =
      distance > regularDistance &&
      isolation >= policy.regularIsolation &&
      margin >= policy.regularEnergyMargin;
    if (early || regular)
      results.push({
        bodyId: body.id,
        tier: early ? 'early' : 'regular',
        distanceAU: distance,
        distanceLightDays: auToLightDays(distance),
        relativeSpeed: speed,
        radialSpeed: radial,
        specificEnergy: energy,
        energyMargin: margin,
        isolation,
      });
  }
  return results;
}
/** Compatibility helper for diagnostics and historical benchmarks. */
export function escapeCandidates(bodies: readonly Body[], config: PhysicsConfig): string[] {
  return readEscapeCandidates(bodies, config).map((e) => e.bodyId);
}
/** Confirmation is in physical time, resets on lost evidence, inward motion or tier change. */
export class EscapeMonitor {
  private observations = new Map<string, { since: number; distance: number; tier: string }>();
  reset(): void {
    this.observations.clear();
  }
  sample(
    evidence: readonly EscapeEvidence[],
    time: number,
    confirmationTime: number,
  ): EscapeEvidence | null {
    const active = new Set(evidence.map((e) => e.bodyId));
    for (const id of this.observations.keys()) if (!active.has(id)) this.observations.delete(id);
    for (const e of evidence) {
      let old = this.observations.get(e.bodyId);
      if (!old || e.distanceAU < old.distance || old.tier !== e.tier)
        old = { since: time, distance: e.distanceAU, tier: e.tier };
      this.observations.set(e.bodyId, { ...old, distance: e.distanceAU });
      if (time - old.since >= confirmationTime) return e;
    }
    return null;
  }
}
