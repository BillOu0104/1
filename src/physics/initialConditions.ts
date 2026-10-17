import type { Body, GeneratorMode, InitialConditionGenerator, PhysicsConfig } from './types';
import { seededRandom } from './random';
import { add, centerOfMass, dot, length, scale, sub } from './vector';
import { totalEnergy } from './gravity';
export class RandomInitializer implements InitialConditionGenerator {
  readonly mode = 'random';
  generate(seed: string, config: PhysicsConfig): Body[] {
    const random = seededRandom(seed);
    const range = (a: number, b: number) => a + random() * (b - a);
    const colors = ['#ffbe7c', '#c7e9ff', '#ff765c'];
    const bodies: Body[] = [];
    for (let i = 0; i < 3; i++) {
      // Separate angular sectors with bounded jitter avoid overlapping initial stars.
      const angle = (i * 2 * Math.PI) / 3 + range(-0.32, 0.32),
        r = range(2.2, 3.8);
      bodies.push({
        id: `star-${i}`,
        name: ['恒星 A · HELIOS', '恒星 B · SIRIUS', '恒星 C · EMBER'][i]!,
        kind: 'star',
        mass: range(0.7, 1.5),
        radius: 0.065,
        color: colors[i]!,
        position: [r * Math.cos(angle), range(-0.8, 0.8), r * Math.sin(angle)],
        velocity: [range(-0.45, 0.45), range(-0.16, 0.16), range(-0.45, 0.45)],
      });
    }
    const center = centerOfMass(bodies),
      drift = centerOfMass(bodies, 'velocity');
    bodies.forEach((b) => {
      b.position = sub(b.position, center);
      b.velocity = sub(b.velocity, drift);
    });
    // Set a bounded sub-virial kinetic energy: initially bound, but never lock orbits.
    const kinetic = bodies.reduce((s, b) => s + 0.5 * b.mass * dot(b.velocity, b.velocity), 0);
    const potential = totalEnergy(bodies, config) - kinetic;
    const factor = Math.sqrt((range(0.3, 0.65) * Math.abs(potential)) / Math.max(kinetic, 1e-12));
    bodies.forEach((b) => {
      b.velocity = scale(b.velocity, factor);
    });
    const host = bodies[0]!,
      angle = range(0, 2 * Math.PI),
      r = range(0.5, 0.8);
    const offset: [number, number, number] = [
      r * Math.cos(angle),
      range(-0.06, 0.06),
      r * Math.sin(angle),
    ];
    const speed = Math.sqrt((config.gravitationalConstant * host.mass) / length(offset));
    bodies.push({
      id: 'planet',
      name: '行星 01 · PEREGRINE',
      kind: 'planet',
      mass: 3e-6,
      radius: 0.018,
      color: '#76c9d5',
      position: add(host.position, offset),
      velocity: add(host.velocity, [
        -speed * Math.sin(angle),
        range(-0.08, 0.08),
        speed * Math.cos(angle),
      ]),
    });
    const finalCenter = centerOfMass(bodies),
      finalDrift = centerOfMass(bodies, 'velocity');
    bodies.forEach((b) => {
      b.position = sub(b.position, finalCenter);
      b.velocity = sub(b.velocity, finalDrift);
    });
    return bodies;
  }
}
export interface GeneratorDescriptor {
  mode: GeneratorMode;
  implemented: boolean;
  create?: () => InitialConditionGenerator;
}
export const GENERATORS: readonly GeneratorDescriptor[] = [
  { mode: 'random', implemented: true, create: () => new RandomInitializer() },
  { mode: 'longLived', implemented: false },
  { mode: 'structuredRandom', implemented: false },
];
