import type { Body } from './types';

export const TRAIL_CAPACITY = 8192;
export const MAX_TRAIL_YEARS = 10;
/** Interleaved [body index, physical time T₀, x AU, y AU, z AU]. */
export interface TrailBatch {
  generation: number;
  bodyIds: string[];
  points: Float64Array;
}
interface Sample {
  anchor: Float64Array;
  pending: Float64Array;
  initialized: boolean;
  hasPending: boolean;
}
const STRIDE = 5;
/** Observes real accepted integrator states. No force evaluations, interpolation or FPS dependency.
 * Almost straight sections are simplified only while their intermediate accepted point stays
 * within a small physical chord tolerance; turning velocity and a time cap preserve encounters.
 */
export class TrajectoryRecorder {
  private generation = -1;
  private ids: string[] = [];
  private samples: Sample[] = [];
  private readonly staging = new Float64Array(4096 * STRIDE);
  private used = 0;
  private append(index: number, state: Float64Array): void {
    if (this.used + STRIDE > this.staging.length)
      throw new Error('Trajectory batch capacity exceeded');
    this.staging[this.used] = index;
    for (let k = 0; k < 4; k++) this.staging[this.used + 1 + k] = state[k]!;
    this.used += STRIDE;
  }
  private write(target: Float64Array, body: Body, time: number): void {
    target[0] = time;
    for (let k = 0; k < 3; k++) {
      target[k + 1] = body.position[k]!;
      target[k + 4] = body.velocity[k]!;
    }
  }
  capture(bodies: readonly Body[], time: number, generation: number): void {
    if (generation !== this.generation) {
      this.generation = generation;
      this.ids = bodies.map((b) => b.id);
      this.samples = bodies.map(() => ({
        anchor: new Float64Array(7),
        pending: new Float64Array(7),
        initialized: false,
        hasPending: false,
      }));
      this.used = 0;
    }
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i]!,
        sample = this.samples[i]!;
      if (!sample.initialized) {
        this.write(sample.anchor, body, time);
        this.append(i, sample.anchor);
        sample.initialized = true;
        continue;
      }
      if (sample.hasPending) {
        const a = sample.anchor,
          p = sample.pending;
        let chord2 = 0,
          projection = 0,
          speed2 = 0,
          oldSpeed2 = 0,
          velocityDot = 0;
        for (let k = 0; k < 3; k++) {
          const d = body.position[k]! - a[k + 1]!;
          chord2 += d * d;
          projection += (p[k + 1]! - a[k + 1]!) * d;
          speed2 += body.velocity[k]! ** 2;
          oldSpeed2 += a[k + 4]! ** 2;
          velocityDot += body.velocity[k]! * a[k + 4]!;
        }
        const fraction = Math.max(0, Math.min(1, projection / Math.max(chord2, 1e-30)));
        let deviation2 = 0;
        for (let k = 0; k < 3; k++)
          deviation2 += (p[k + 1]! - a[k + 1]! - fraction * (body.position[k]! - a[k + 1]!)) ** 2;
        let scale = Infinity;
        for (const other of bodies)
          if (other !== body)
            scale = Math.min(
              scale,
              Math.hypot(
                body.position[0] - other.position[0],
                body.position[1] - other.position[1],
                body.position[2] - other.position[2],
              ),
            );
        const tolerance = Math.max(1e-6, Math.min(0.001, scale * 0.0002));
        const turning = velocityDot < Math.cos(0.025) * Math.sqrt(speed2 * oldSpeed2);
        const accelerating = Math.abs(speed2 - oldSpeed2) > 0.04 * Math.max(speed2, oldSpeed2);
        if (deviation2 > tolerance ** 2 || turning || accelerating || time - a[0]! >= 0.5) {
          this.append(i, p);
          a.set(p);
        }
      }
      this.write(sample.pending, body, time);
      sample.hasPending = true;
    }
  }
  drain(): TrailBatch {
    // Include the latest endpoint on every transport batch, so a pause never leaves an old tail.
    for (let i = 0; i < this.samples.length; i++) {
      const sample = this.samples[i]!;
      if (sample.hasPending) {
        this.append(i, sample.pending);
        sample.anchor.set(sample.pending);
        sample.hasPending = false;
      }
    }
    const points = this.staging.slice(0, this.used);
    this.used = 0;
    return { generation: this.generation, bodyIds: this.ids, points };
  }
}
