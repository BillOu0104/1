import * as detection from '../src/physics/detection';
import { AdaptiveDopri5 } from '../src/physics/adaptive';
import { expect, it, vi } from 'vitest';
import {
  DEFAULT_CAGE,
  CAGE_LENGTH_AU,
  CAGE_MASS_SOLAR,
  cageShape,
  addCageDerivative,
  validateCage,
} from '../src/physics/cage';
import { DEFAULT_PHYSICS, type Body } from '../src/physics/types';
import { accelerations } from '../src/physics/gravity';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { readEscapeCandidates } from '../src/physics/detection';
const pair = (): Body[] => [
  {
    id: 'a',
    name: 'a',
    kind: 'star',
    mass: 1,
    radius: 1e-5,
    color: '#fff',
    position: [-2, 0, 0],
    velocity: [0, -0.4, 0],
  },
  {
    id: 'b',
    name: 'b',
    kind: 'star',
    mass: 2,
    radius: 1e-5,
    color: '#fff',
    position: [1, 0, 0],
    velocity: [0, 0.2, 0],
  },
];
it('matches confirmed soft and hard branches away from documented regularization bands', () => {
  const c = { ...DEFAULT_CAGE };
  expect(cageShape(0.05, { ...c, k1: 1 })).toBeCloseTo(-((1 - 0.25) ** 2), 12);
  expect(cageShape(0.2, c)).toBe(0);
  expect(cageShape(1, c)).toBeCloseTo(0.5 * 0.8 ** 2, 12);
  expect(cageShape(1, { ...c, hard: true })).toBeCloseTo(
    (0.5 * 0.8) / Math.sqrt(2.1 ** 2 - 0.8 ** 2),
    12,
  );
  expect(cageShape(3, { ...c, hard: true })).toBe(50);
  expect(cageShape(2.5, { ...c, hard: true, rc: 3 })).toBe(0);
  expect(cageShape(4, { ...c, hard: true, rc: 3 })).toBe(50);
  expect(cageShape(0.05, { ...c, rc: 0, k1: 1 })).toBeCloseTo(-((1 - 0.25) ** 2), 12);
  expect(cageShape(0, { ...c, k1: 1 })).toBe(0);
});
it('converts the original mass/length units and scales cage acceleration by k⁻²', () => {
  expect(CAGE_LENGTH_AU).toBeCloseTo(6.684587, 6);
  expect(DEFAULT_CAGE.mass * CAGE_MASS_SOLAR).toBeCloseTo(1.50869764, 7);
  const bodies = pair(),
    pack = new Float64Array(12);
  bodies.forEach((b, i) => {
    pack.set(b.position, i * 6);
    pack.set(b.velocity, i * 6 + 3);
  });
  const a = new Float64Array(16),
    b = new Float64Array(16);
  addCageDerivative(pack, a, bodies, { ...DEFAULT_PHYSICS, cage: { ...DEFAULT_CAGE } });
  for (let i = 0; i < 2; i++) for (let k = 0; k < 3; k++) pack[i * 6 + k]! *= 3;
  addCageDerivative(pack, b, bodies, {
    ...DEFAULT_PHYSICS,
    galaxyScale: 3,
    cage: { ...DEFAULT_CAGE },
  });
  for (let i = 0; i < 2; i++)
    for (let k = 0; k < 3; k++) expect(b[i * 6 + 3 + k]).toBeCloseTo(a[i * 6 + 3 + k]! / 9, 12);
});
it('is finite and continuous at the center and all reordered hard/soft transitions', () => {
  for (const hard of [false, true])
    for (const rc of [0, 0.05, 0.2, 3]) {
      const cage = { ...DEFAULT_CAGE, hard, rc, k1: 1 };
      for (const boundary of [0, cage.re, cage.rc, cage.hardRadius]) {
        const left = cageShape(Math.max(0, boundary - 1e-10), cage),
          right = cageShape(boundary + 1e-10, cage);
        expect(Number.isFinite(left + right)).toBe(true);
        expect(Math.abs(left - right)).toBeLessThan(1e-4);
      }
    }
});
it('disabled means exactly the Newtonian kernel and k2=0 does not disable inner repulsion', () => {
  const bodies = pair();
  expect(
    accelerations(bodies, { ...DEFAULT_PHYSICS, cage: { ...DEFAULT_CAGE, enabled: false } }),
  ).toEqual(accelerations(bodies, DEFAULT_PHYSICS));
  expect(cageShape(0.05, { ...DEFAULT_CAGE, k1: 1, k2: 0 })).toBeLessThan(0);
  expect(cageShape(1, { ...DEFAULT_CAGE, k1: 1, k2: 0 })).toBe(0);
  expect(() => validateCage({ ...DEFAULT_CAGE, exponent: 0 })).toThrow();
  expect(() => validateCage({ ...DEFAULT_CAGE, mass: NaN })).toThrow();
});
it('accounts for external work/impulse rather than calling physical Newtonian-energy change numerical failure', () => {
  const bodies = pair();
  bodies[0]!.position = [-6, 0, 0];
  bodies[1]!.position = [3, 0, 0];
  const engine = new SimulationEngine('work', {
    initialBodies: bodies,
    config: { cage: { ...DEFAULT_CAGE } },
    tides: { enabled: false },
  });
  engine.setControls({ autoRestart: false, speed: 20 });
  for (let i = 0; i < 200; i++) engine.advance(0.05);
  const s = engine.snapshot();
  expect(s.reason).toBeNull();
  expect(s.system?.diagnosticMode).toBe('external-work');
  expect(Math.abs(s.system!.rawEnergyChange)).toBeGreaterThan(1e-3);
  expect(Math.abs(s.relativeEnergyError)).toBeLessThan(1e-6);
  expect(s.diagnostics.momentumError).toBeLessThan(1e-8);
  expect(s.diagnostics.angularMomentumError).toBeLessThan(1e-6);
  const time = s.time,
    generation = s.generation;
  engine.setCage({ ...DEFAULT_CAGE, enabled: false });
  expect(engine.snapshot().system?.diagnosticMode).toBe('newtonian');
  expect(engine.getTime()).toBe(time);
  expect(engine.getGeneration()).toBe(generation);
  expect(engine.snapshot().relativeEnergyError).toBe(0);
});
it('resolves a hard-wall crossing, allows an outward body to return, and never reflects or clamps coordinates', () => {
  const bodies = pair();
  bodies[0]!.position = [-8, 0, 0];
  bodies[1]!.position = [4, 0, 0];
  bodies[0]!.velocity = [-1, 0.1, 0];
  bodies[1]!.velocity = [0.5, -0.05, 0];
  const engine = new SimulationEngine('hard', {
    initialBodies: bodies,
    config: { cage: { ...DEFAULT_CAGE, hard: true } },
    tides: { enabled: false },
  });
  engine.setControls({ autoRestart: false, speed: 20 });
  let crossed = false,
    returned = false;
  for (let i = 0; i < 200; i++) {
    engine.advance(0.05);
    const r = Math.hypot(...engine.getBodies()[0]!.position);
    crossed ||= r > CAGE_LENGTH_AU * 2.1;
    returned ||= crossed && r < CAGE_LENGTH_AU * 2;
  }
  expect(engine.getReason()).toBeNull();
  expect(crossed).toBe(true);
  expect(returned).toBe(true);
  expect(Math.abs(engine.snapshot().relativeEnergyError)).toBeLessThan(1e-5);
});
it('suppresses permanent-escape claims under an outer cage, resumes them when removed', () => {
  const bodies = pair();
  bodies[0]!.position = [-200, 0, 0];
  bodies[0]!.velocity = [-2, 0, 0];
  expect(readEscapeCandidates(bodies, { ...DEFAULT_PHYSICS, cage: { ...DEFAULT_CAGE } })).toEqual(
    [],
  );
  expect(
    readEscapeCandidates(bodies, { ...DEFAULT_PHYSICS, cage: { ...DEFAULT_CAGE, enabled: false } })
      .length,
  ).toBeGreaterThan(0);
  expect(
    readEscapeCandidates(bodies, { ...DEFAULT_PHYSICS, cage: { ...DEFAULT_CAGE, k2: 0 } }).length,
  ).toBeGreaterThan(0);
});

it('rolls external work/impulse back with positions when a curved chord needs refinement', () => {
  const original = detection.detectCollision;
  let forced = false,
    checked = false;
  const collision = vi.spyOn(detection, 'detectCollision').mockImplementation((b, previous) => {
    if (previous && !forced) {
      forced = true;
      return { type: 'collision', message: 'test chord', bodyIds: ['a', 'b'] };
    }
    return original(b, previous);
  });
  const refine = AdaptiveDopri5.prototype.refine;
  const spy = vi.spyOn(AdaptiveDopri5.prototype, 'refine').mockImplementation(function (
    this: AdaptiveDopri5,
    dt,
  ) {
    checked = true;
    expect(this.externalWork).toBe(0);
    expect(this.externalImpulse).toEqual([0, 0, 0]);
    refine.call(this, dt);
  });
  try {
    const bodies = pair();
    bodies[0]!.position = [-6, 0, 0];
    bodies[1]!.position = [3, 0, 0];
    bodies[0]!.velocity = [-0.4, 0, 0];
    bodies[1]!.velocity = [0.2, 0, 0];
    const engine = new SimulationEngine('rollback', {
      initialBodies: bodies,
      config: { cage: { ...DEFAULT_CAGE } },
      tides: { enabled: false },
    });
    engine.advance(0.1);
    expect(checked).toBe(true);
    expect(engine.getReason()).toBeNull();
    expect(Math.abs(engine.snapshot().relativeEnergyError)).toBeLessThan(1e-8);
  } finally {
    spy.mockRestore();
    collision.mockRestore();
  }
});
