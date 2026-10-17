import type { Body, Integrator, PhysicsConfig } from './types';
import { accelerations } from './gravity';
import { add, scale } from './vector';
export class VelocityVerlet implements Integrator {
  readonly id = 'velocity-verlet';
  step(bodies: Body[], dt: number, config: PhysicsConfig): void {
    const before = accelerations(bodies, config);
    bodies.forEach((b, i) => {
      b.position = add(b.position, add(scale(b.velocity, dt), scale(before[i]!, 0.5 * dt * dt)));
    });
    const after = accelerations(bodies, config);
    bodies.forEach((b, i) => {
      b.velocity = add(b.velocity, scale(add(before[i]!, after[i]!), 0.5 * dt));
    });
  }
}
