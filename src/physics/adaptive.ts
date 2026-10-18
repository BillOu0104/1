import { cageStepLimit } from './cage';
import { derivative, pack, unpack } from './velocityVerlet';
import type { Body, PhysicsConfig, Vec3 } from './types';
import { length, sub } from './vector';
export interface AdaptiveConfig {
  relativeTolerance: number;
  absoluteTolerance: number;
  minStep: number;
  maxStep: number;
  safety: number;
}
export const DEFAULT_ADAPTIVE: Readonly<AdaptiveConfig> = {
  relativeTolerance: 1e-9,
  absoluteTolerance: 1e-12,
  minStep: 1e-8,
  maxStep: 0.06,
  safety: 0.12,
};
export function dynamicalStep(
  bodies: readonly Body[],
  config: PhysicsConfig,
  safety = 0.12,
): number {
  let dt = Infinity;
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!,
        b = bodies[j]!,
        r = Math.hypot(length(sub(a.position, b.position)), config.softening),
        v = length(sub(a.velocity, b.velocity));
      const dynamical = Math.sqrt(r ** 3 / (config.gravitationalConstant * (a.mass + b.mass)));
      dt = Math.min(dt, safety * dynamical, (safety * r) / Math.max(v, 1e-20));
    }
  return Math.min(dt, cageStepLimit(bodies, config, safety));
}
const A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
const B = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const E = [
  35 / 384 - 5179 / 57600,
  0,
  500 / 1113 - 7571 / 16695,
  125 / 192 - 393 / 640,
  -2187 / 6784 + 92097 / 339200,
  11 / 84 - 187 / 2100,
  -1 / 40,
];
/** Dormand–Prince 5(4), embedded local-error control. Variable steps are NOT symplectic. */
export class AdaptiveDopri5 {
  readonly id = 'dopri5-adaptive';
  readonly options: AdaptiveConfig;
  private state = new Float64Array();
  private work = new Float64Array();
  private next = new Float64Array();
  private stages: Float64Array[] = [];
  private proposed = 0.01;
  rejected = 0;
  externalWork = 0;
  externalImpulse: Vec3 = [0, 0, 0];
  constructor(options: Partial<AdaptiveConfig> = {}) {
    this.options = { ...DEFAULT_ADAPTIVE, ...options };
    if (
      !Object.values(this.options).every((v) => Number.isFinite(v) && v > 0) ||
      this.options.maxStep < this.options.minStep ||
      this.options.safety > 1
    )
      throw new Error('Invalid adaptive configuration');
  }
  refine(dt: number): void {
    this.proposed = dt * 0.5;
  }
  reset(): void {
    this.proposed = 0.01;
    this.rejected = 0;
    this.externalWork = 0;
    this.externalImpulse = [0, 0, 0];
  }
  attempt(
    bodies: Body[],
    limit: number,
    config: PhysicsConfig,
    extraLimit = Infinity,
  ): { accepted: boolean; dt: number; error: number } {
    const extra = bodies.length * 6;
    const n = extra + (config.cage?.enabled ? 4 : 0);
    if (this.state.length !== n) {
      this.state = new Float64Array(n);
      this.work = new Float64Array(n);
      this.next = new Float64Array(n);
      this.stages = Array.from({ length: 7 }, () => new Float64Array(n));
    }
    const dt = Math.min(
      limit,
      this.proposed,
      this.options.maxStep,
      dynamicalStep(bodies, config, this.options.safety),
      extraLimit,
    );
    if (!Number.isFinite(dt) || dt <= 0) throw new Error('Invalid adaptive step');
    if (dt < this.options.minStep && limit >= this.options.minStep)
      throw new Error('Accuracy limit reached');
    pack(bodies, this.state);
    if (n > extra) {
      this.state[extra] = this.externalWork;
      this.state.set(this.externalImpulse, extra + 1);
    }
    derivative(this.state, this.stages[0]!, bodies, config);
    for (let stage = 1; stage < 7; stage++) {
      for (let q = 0; q < n; q++) {
        let sum = 0;
        for (let k = 0; k < stage; k++) sum += A[stage]![k]! * this.stages[k]![q]!;
        this.work[q] = this.state[q]! + dt * sum;
      }
      derivative(this.work, this.stages[stage]!, bodies, config);
    }
    let error = 0;
    for (let q = 0; q < n; q++) {
      let increment = 0,
        estimate = 0;
      for (let k = 0; k < 7; k++) {
        increment += B[k]! * this.stages[k]![q]!;
        estimate += E[k]! * this.stages[k]![q]!;
      }
      this.next[q] = this.state[q]! + dt * increment;
      const tolerance =
        this.options.absoluteTolerance +
        this.options.relativeTolerance *
          Math.max(Math.abs(this.state[q]!), Math.abs(this.next[q]!));
      error = Math.max(error, Math.abs(dt * estimate) / tolerance);
    }
    const accepted = Number.isFinite(error) && error <= 1;
    const nextProposal = dt * Math.max(0.15, Math.min(4, 0.9 * Math.max(error, 1e-16) ** -0.2));
    // A tiny final fragment of a scheduling macro step is not a physical accuracy limit.
    // Retain the unconstrained proposal after accepting it, rather than poisoning the next macro.
    this.proposed =
      accepted && limit < this.options.minStep
        ? Math.max(this.options.minStep, Math.min(this.proposed, this.options.maxStep))
        : nextProposal;
    if (accepted) {
      unpack(this.next, bodies);
      if (n > extra) {
        this.externalWork = this.next[extra]!;
        for (let k = 0; k < 3; k++) this.externalImpulse[k] = this.next[extra + 1 + k]!;
      }
    } else {
      this.rejected++;
      if (this.proposed < this.options.minStep)
        throw new Error('Unable to resolve close encounter');
    }
    return { accepted, dt, error };
  }
}
