import { expect, it } from 'vitest';
import { DEFAULT_PHYSICS, type Body } from '../src/physics/types';
import { EscapeMonitor, readEscapeCandidates } from '../src/physics/detection';
import { auToLightDays, lightDaysToAu } from '../src/physics/parameters';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
const body = (id: string, x: number, mass: number, vx = 0): Body => ({
  id,
  name: id,
  kind: mass < 0.01 ? 'planet' : 'star',
  mass,
  radius: 1e-5,
  color: '#fff',
  position: [x, 0, 0],
  velocity: [vx, 0, 0],
});
const probe = (bodies: Body[]) =>
  readEscapeCandidates(bodies, DEFAULT_PHYSICS).find((e) => e.bodyId === 'out');
it('uses 20 AU early versus the old 100 AU gate, with consistent AU / light-day conversions', () => {
  const bodies = [body('out', 21, 3e-6, 1), body('a', -1, 1), body('b', 0, 1), body('c', 1, 1)];
  const e = probe(bodies)!;
  expect(e.tier).toBe('early');
  expect(e.distanceAU).toBe(21);
  expect(e.distanceAU).toBeLessThan(DEFAULT_PHYSICS.escapeDistance);
  expect(auToLightDays(100)).toBeCloseTo(0.57755, 4);
  expect(lightDaysToAu(e.distanceLightDays)).toBeCloseTo(21, 12);
  expect(e.specificEnergy).toBeGreaterThan(0);
  expect(e.relativeSpeed).toBe(1);
});
it('never terminates distant bound, inbound, marginal or unresolved multi-body encounters', () => {
  const bodies = [body('out', 120, 3e-6, 0.1), body('a', -1, 1), body('b', 0, 1), body('c', 1, 1)];
  expect(probe(bodies)).toBeUndefined(); // bound despite r > 100 AU
  bodies[0]!.velocity[0] = -1;
  expect(probe(bodies)).toBeUndefined();
  bodies[0]!.velocity = [0.01, 1, 0];
  bodies[0]!.position[0] = 21;
  expect(probe(bodies)).toBeUndefined(); // mainly tangential, no early escape
  bodies[0]!.velocity = [1, 0, 0];
  bodies[1]!.position[0] = 15;
  bodies[2]!.position[0] = -15;
  expect(probe(bodies)).toBeUndefined(); // remaining cluster not compact
});
it('defers weakly positive energy until the regular gate and rejects a bound companion', () => {
  const bodies = [body('out', 25, 3e-6, Math.sqrt(2.1 / 25)), body('host', 0, 1)];
  expect(probe(bodies)).toBeUndefined();
  bodies[0]!.position[0] = 120;
  bodies[0]!.velocity[0] = Math.sqrt(2.1 / 120);
  expect(probe(bodies)?.tier).toBe('regular');
  bodies.push(body('companion', 120.1, 1, bodies[0]!.velocity[0]));
  expect(probe(bodies)).toBeUndefined();
});
it('is invariant to translating and boosting the whole system', () => {
  const bodies = [body('out', 25, 1, 2), body('a', -1, 1), body('b', 1, 1)];
  const before = probe(bodies)!;
  for (const b of bodies)
    for (let a = 0; a < 3; a++) {
      b.position[a] = b.position[a]! + 1000;
      b.velocity[a] = b.velocity[a]! + 3;
    }
  expect(probe(bodies)).toEqual(before);
});
it('requires continuous confirmation and resets evidence after an inward excursion', () => {
  const e = probe([body('out', 25, 3e-6, 1), body('host', 0, 1)])!;
  const monitor = new EscapeMonitor();
  expect(monitor.sample([e], 0, 1)).toBeNull();
  expect(monitor.sample([{ ...e, distanceAU: 25.5 }], 0.5, 1)).toBeNull();
  expect(monitor.sample([], 0.6, 1)).toBeNull();
  expect(monitor.sample([e], 0.7, 1)).toBeNull();
  expect(monitor.sample([{ ...e, distanceAU: 26 }], 1.2, 1)).toBeNull();
  expect(monitor.sample([{ ...e, distanceAU: 27 }], 1.8, 1)?.bodyId).toBe('out');
  monitor.reset();
  expect(monitor.sample([e], 5, 1)).toBeNull();
});
it.each([3e-6, 0.9])(
  'records the escaping body kind (%s), evidence and restarts through the existing lifecycle',
  (mass) => {
    const engine = new SimulationEngine('escape', {
      initialBodies: [body('out', 21, mass, 2), body('host', 0, 1)],
      tides: { enabled: false },
    });
    engine.setControls({ speed: 20 });
    for (let i = 0; i < 30 && !engine.getReason(); i++) engine.advance(0.02);
    const ended = engine.snapshot();
    expect(ended.reason?.type).toBe('escape');
    expect(ended.reason?.escapeKind).toBe(mass < 0.01 ? 'planet' : 'star');
    expect(ended.reason?.escape?.distanceAU).toBeLessThan(30);
    expect(ended.events[0]?.reason?.escape?.specificEnergy).toBeGreaterThan(0);
    for (let i = 0; i < 12; i++) engine.advance(0.2);
    expect(engine.snapshot().restartCount).toBe(1);
    expect(engine.snapshot().generation).toBe(ended.generation + 1);
  },
);
it('lets a genuinely bound orbit pass the distance gates, turn around and return over multiple periods', () => {
  const host = body('host', 0, 1),
    planet = body('out', 5, 3e-6, 0.3);
  planet.velocity[1] = 0.3;
  const engine = new SimulationEngine('bound-return', {
    initialBodies: [host, planet],
    tides: { enabled: false },
    config: { escapeDistance: 3, escapePolicy: { earlyDistance: 1 } },
  });
  engine.setControls({ speed: 20, autoRestart: false });
  let far = false,
    returned = false;
  for (let i = 0; i < 120; i++) {
    engine.advance(0.05);
    const [a, b] = engine.getBodies();
    const distance = Math.hypot(...b!.position.map((x, k) => x - a!.position[k]!));
    far ||= distance > 6;
    returned ||= far && distance < 4;
  }
  expect(far).toBe(true);
  expect(returned).toBe(true);
  expect(engine.getReason()).toBeNull();
});
