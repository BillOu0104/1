import type { Body, PhysicsConfig, Vec3 } from './types';
import { AU_METERS, SOLAR_MASS_KG, TIME_UNIT_SECONDS } from './parameters';
import { dot, sub } from './vector';
export interface TidalConfig {
  enabled: boolean;
  strengthPa: number;
  rocheCoefficient: number;
  responseTimes: number;
}
export const DEFAULT_TIDES: Readonly<TidalConfig> = {
  enabled: true,
  strengthPa: 1e7,
  rocheCoefficient: 2.44,
  responseTimes: 2,
};
export interface TidalReading {
  ratio: number;
  threshold: number;
  lambda: number;
  selfGravity: number;
  density: number;
  responseTime: number;
  dominantStarId: string | null;
  contributors: string[];
}
/** Largest algebraic eigenvalue + direction of a symmetric 3×3 tensor (Jacobi rotations). */
export function principalEigenpair(tensor: readonly number[]): { value: number; direction: Vec3 } {
  const a = [...tensor],
    v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let k = 0; k < 16; k++) {
    let p = 0,
      q = 1;
    for (const [i, j] of [
      [0, 2],
      [1, 2],
    ])
      if (Math.abs(a[i! * 3 + j!]!) > Math.abs(a[p * 3 + q]!)) {
        p = i!;
        q = j!;
      }
    const off = a[p * 3 + q]!;
    if (Math.abs(off) < 1e-14 * Math.max(1, ...a.map(Math.abs))) break;
    const angle = 0.5 * Math.atan2(2 * off, a[q * 3 + q]! - a[p * 3 + p]!),
      c = Math.cos(angle),
      s = Math.sin(angle);
    const app = a[p * 3 + p]!,
      aqq = a[q * 3 + q]!;
    for (let i = 0; i < 3; i++)
      if (i !== p && i !== q) {
        const ip = a[i * 3 + p]!,
          iq = a[i * 3 + q]!;
        a[i * 3 + p] = a[p * 3 + i] = c * ip - s * iq;
        a[i * 3 + q] = a[q * 3 + i] = s * ip + c * iq;
      }
    a[p * 3 + p] = c * c * app - 2 * s * c * off + s * s * aqq;
    a[q * 3 + q] = s * s * app + 2 * s * c * off + c * c * aqq;
    a[p * 3 + q] = a[q * 3 + p] = 0;
    for (let i = 0; i < 3; i++) {
      const ip = v[i * 3 + p]!,
        iq = v[i * 3 + q]!;
      v[i * 3 + p] = c * ip - s * iq;
      v[i * 3 + q] = s * ip + c * iq;
    }
  }
  let index = 0;
  for (let i = 1; i < 3; i++) if (a[i * 3 + i]! > a[index * 3 + index]!) index = i;
  return { value: a[index * 3 + index]!, direction: [v[index]!, v[3 + index]!, v[6 + index]!] };
}
export function tidalField(
  planet: Body,
  stars: readonly Body[],
  config: PhysicsConfig,
  model: TidalConfig = DEFAULT_TIDES,
): TidalReading {
  const tensor = Array<number>(9).fill(0),
    parts: { id: string; tensor: number[] }[] = [];
  for (const star of stars) {
    const r = sub(star.position, planet.position),
      r2 = Math.max(dot(r, r) + config.softening ** 2, 1e-30);
    const factor = (config.gravitationalConstant * star.mass) / r2 ** 1.5;
    const part = Array.from(
      { length: 9 },
      (_, k) =>
        factor *
        ((3 * r[Math.floor(k / 3)]! * r[k % 3]!) / r2 - (Math.floor(k / 3) === k % 3 ? 1 : 0)),
    );
    for (let k = 0; k < 9; k++) tensor[k]! += part[k]!;
    parts.push({ id: star.id, tensor: part });
  }
  const { value, direction } = principalEigenpair(tensor),
    selfGravity = (config.gravitationalConstant * planet.mass) / planet.radius ** 3;
  const density =
    (planet.mass * SOLAR_MASS_KG) / (((4 * Math.PI) / 3) * (planet.radius * AU_METERS) ** 3);
  const strengthRate =
    (model.strengthPa / (density * (planet.radius * AU_METERS) ** 2)) * TIME_UNIT_SECONDS ** 2;
  const threshold = 2 / model.rocheCoefficient ** 3 + strengthRate / selfGravity;
  const contributions = parts
    .map((p) => ({
      id: p.id,
      value: p.tensor.reduce(
        (s, t, k) => s + t * direction[Math.floor(k / 3)]! * direction[k % 3]!,
        0,
      ),
    }))
    .sort((a, b) => b.value - a.value);
  return {
    ratio: Math.max(0, value) / selfGravity,
    threshold,
    lambda: value,
    selfGravity,
    density,
    responseTime: 1 / Math.sqrt(selfGravity),
    dominantStarId: contributions[0]?.id ?? null,
    contributors: contributions.filter((p) => p.value > 0).map((p) => p.id),
  };
}
export class TidalMonitor {
  exposure = 0;
  private lastAbove = false;
  reset(): void {
    this.exposure = 0;
    this.lastAbove = false;
  }
  sample(reading: TidalReading, dt: number, model: TidalConfig = DEFAULT_TIDES): boolean {
    const above = reading.ratio > reading.threshold;
    // Both ends must be above threshold. A single spike contributes no exposure.
    if (above && this.lastAbove) this.exposure += dt;
    else this.exposure = 0;
    this.lastAbove = above;
    return this.exposure >= model.responseTimes * reading.responseTime;
  }
}
export function readPlanetTides(
  bodies: readonly Body[],
  config: PhysicsConfig,
  model: TidalConfig = DEFAULT_TIDES,
): TidalReading | null {
  const planet = bodies.find((b) => b.kind === 'planet');
  return planet
    ? tidalField(
        planet,
        bodies.filter((b) => b.kind === 'star'),
        config,
        model,
      )
    : null;
}
/** Resolve exposure history near Roche conditions, independently of the integrator's distance bound. */
export function tidalStepLimit(reading: TidalReading | null): number {
  return reading && reading.ratio > reading.threshold * 0.5
    ? reading.responseTime * 0.25
    : Infinity;
}
