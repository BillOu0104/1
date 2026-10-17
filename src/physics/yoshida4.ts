import type { Body, Integrator, PhysicsConfig } from './types';
import { VelocityVerlet } from './velocityVerlet';
/** Yoshida 1990 triple-jump composition. Negative internal stage: collision events use end states. */
export class Yoshida4 implements Integrator {
  readonly id = 'yoshida4';
  private verlet = new VelocityVerlet();
  reset(): void {
    this.verlet.reset();
  }
  step(bodies: Body[], dt: number, config: PhysicsConfig): void {
    const w = 1 / (2 - Math.cbrt(2));
    this.verlet.step(bodies, w * dt, config);
    this.verlet.step(bodies, (1 - 2 * w) * dt, config);
    this.verlet.step(bodies, w * dt, config);
  }
}
