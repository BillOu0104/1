export type Vec3 = [number, number, number];
export interface Body {
  id: string;
  name: string;
  kind: 'star' | 'planet';
  mass: number;
  /** Collision radius in normalized distance units, independent of visual radius. */
  radius: number;
  color: string;
  position: Vec3;
  velocity: Vec3;
}
export interface PhysicsConfig {
  gravitationalConstant: number;
  timeStep: number;
  softening: number;
  escapeDistance: number;
  escapeConfirmationTime: number;
  maxStepsPerFrame: number;
  unitsPerSecond: number;
}
export const DEFAULT_PHYSICS: Readonly<PhysicsConfig> = Object.freeze({
  gravitationalConstant: 1,
  timeStep: 0.002,
  softening: 0.008,
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
}
export type GeneratorMode = 'random' | 'longLived' | 'structuredRandom';
export interface InitialConditionGenerator {
  readonly mode: GeneratorMode;
  generate(seed: string, config: PhysicsConfig): Body[];
}
export const copyBodies = (bodies: readonly Body[]): Body[] =>
  bodies.map((b) => ({ ...b, position: [...b.position], velocity: [...b.velocity] }));
