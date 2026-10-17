export type Vec3 = [number, number, number];
export interface Body {
  id: string;
  name: string;
  kind: 'star' | 'planet';
  mass: number;
  /** Collision radius in normalized distance units, independent of visual radius. */
  radius: number;
  color: string;
  luminosity?: number;
  temperatureK?: number;
  position: Vec3;
  velocity: Vec3;
}
export interface EscapePolicy {
  earlyDistance: number;
  earlyIsolation: number;
  regularIsolation: number;
  earlyEnergyMargin: number;
  regularEnergyMargin: number;
  earlyRadialFraction: number;
}
export const DEFAULT_ESCAPE_POLICY: Readonly<EscapePolicy> = Object.freeze({
  earlyDistance: 20,
  earlyIsolation: 6,
  regularIsolation: 3,
  earlyEnergyMargin: 0.25,
  regularEnergyMargin: 1e-4,
  earlyRadialFraction: 0.6,
});
export interface PhysicsConfig {
  gravitationalConstant: number;
  timeStep: number;
  softening: number;
  escapeDistance: number;
  escapeConfirmationTime: number;
  /** Optional AU / T₀ policy; absent fields use conservative defaults. */
  escapePolicy?: Partial<EscapePolicy>;
  maxStepsPerFrame: number;
  unitsPerSecond: number;
}
export const DEFAULT_PHYSICS: Readonly<PhysicsConfig> = Object.freeze({
  gravitationalConstant: 1,
  timeStep: 0.002,
  softening: 1e-6,
  escapeDistance: 100,
  escapeConfirmationTime: 1,
  maxStepsPerFrame: 256,
  unitsPerSecond: 0.6,
});
/** With G=1, 1 solar mass and 1 AU, a terrestrial year is 2π time units. */
export const UNITS_PER_YEAR = 2 * Math.PI;
export interface Integrator {
  readonly id: string;
  step(bodies: Body[], dt: number, config: PhysicsConfig): void;
  reset?(): void;
}
export type GeneratorMode = 'random' | 'structuredChaos' | 'longLived' | 'structuredRandom';
export interface InitialConditionGenerator {
  readonly mode: GeneratorMode;
  generate(seed: string, config: PhysicsConfig): Body[];
}
export const copyBodies = (bodies: readonly Body[]): Body[] =>
  bodies.map((b) => ({ ...b, position: [...b.position], velocity: [...b.velocity] }));
