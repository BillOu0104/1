import type { Body, Integrator, PhysicsConfig } from './types';
/** Pairwise kernel shared by the allocation-free integrators; state = xyz,vxyz per body. */
export function derivative(
  state: Float64Array,
  out: Float64Array,
  bodies: readonly Body[],
  config: PhysicsConfig,
): void {
  out.fill(0);
  for (let i = 0; i < bodies.length; i++)
    for (let a = 0; a < 3; a++) out[i * 6 + a] = state[i * 6 + 3 + a]!;
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      const x = state[j * 6]! - state[i * 6]!,
        y = state[j * 6 + 1]! - state[i * 6 + 1]!,
        z = state[j * 6 + 2]! - state[i * 6 + 2]!;
      const r2 = Math.max(x * x + y * y + z * z + config.softening ** 2, 1e-30),
        f = config.gravitationalConstant / (r2 * Math.sqrt(r2));
      const mi = bodies[i]!.mass,
        mj = bodies[j]!.mass;
      out[i * 6 + 3]! += x * f * mj;
      out[i * 6 + 4]! += y * f * mj;
      out[i * 6 + 5]! += z * f * mj;
      out[j * 6 + 3]! -= x * f * mi;
      out[j * 6 + 4]! -= y * f * mi;
      out[j * 6 + 5]! -= z * f * mi;
    }
}
export function pack(bodies: readonly Body[], state: Float64Array): void {
  bodies.forEach((b, i) => {
    for (let a = 0; a < 3; a++) {
      state[i * 6 + a] = b.position[a]!;
      state[i * 6 + 3 + a] = b.velocity[a]!;
    }
  });
}
export function unpack(state: Float64Array, bodies: Body[]): void {
  bodies.forEach((b, i) => {
    for (let a = 0; a < 3; a++) {
      b.position[a] = state[i * 6 + a]!;
      b.velocity[a] = state[i * 6 + 3 + a]!;
    }
  });
}
export class VelocityVerlet implements Integrator {
  readonly id = 'velocity-verlet';
  private cached: Float64Array = new Float64Array();
  private before: Float64Array = new Float64Array();
  private after: Float64Array = new Float64Array();
  private lastConfig = '';
  private masses: number[] = [];
  reset(): void {
    this.lastConfig = '';
  }
  step(bodies: Body[], dt: number, config: PhysicsConfig): void {
    const n = bodies.length * 6,
      key = `${config.gravitationalConstant}:${config.softening}`;
    if (this.cached.length !== n) {
      this.cached = new Float64Array(n);
      this.before = new Float64Array(n);
      this.after = new Float64Array(n);
      this.reset();
    }
    const reusable =
      this.lastConfig === key &&
      bodies.every(
        (b, i) =>
          b.mass === this.masses[i] && b.position.every((v, a) => v === this.cached[i * 6 + a]),
      );
    pack(bodies, this.cached);
    if (!reusable) derivative(this.cached, this.before, bodies, config);
    for (let i = 0; i < bodies.length; i++)
      for (let a = 0; a < 3; a++)
        this.cached[i * 6 + a]! +=
          this.cached[i * 6 + 3 + a]! * dt + this.before[i * 6 + 3 + a]! * dt * dt * 0.5;
    derivative(this.cached, this.after, bodies, config);
    for (let i = 0; i < bodies.length; i++)
      for (let a = 0; a < 3; a++)
        this.cached[i * 6 + 3 + a]! +=
          0.5 * dt * (this.before[i * 6 + 3 + a]! + this.after[i * 6 + 3 + a]!);
    unpack(this.cached, bodies);
    [this.before, this.after] = [this.after, this.before];
    this.lastConfig = key;
    this.masses = bodies.map((b) => b.mass);
  }
}
