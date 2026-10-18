import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { RandomInitializer } from '../src/physics/initialConditions';
import type { Body, InitialConditionGenerator, Integrator } from '../src/physics/types';
const advance = (engine: SimulationEngine, seconds: number) => {
  for (let t = 0; t < Math.round(seconds * 100); t++) engine.advance(0.01);
};
const collidingGenerator: InitialConditionGenerator = {
  mode: 'random',
  generate: () => {
    const bodies = new RandomInitializer().generate('collision', {
      gravitationalConstant: 1,
      timeStep: 0.002,
      softening: 0.008,
      escapeDistance: 100,
      escapeConfirmationTime: 1,
      maxStepsPerFrame: 256,
      unitsPerSecond: 0.6,
    });
    bodies[1]!.position = [...bodies[0]!.position];
    return bodies;
  },
};
describe('fixed step simulation lifecycle', () => {
  it('advances in physical time, pauses completely and resumes without backlog', () => {
    const engine = new SimulationEngine('pause');
    advance(engine, 1);
    expect(engine.snapshot().time).toBeCloseTo(0.6, 10);
    engine.setControls({ paused: true });
    const before = engine.snapshot();
    advance(engine, 10);
    expect(engine.snapshot()).toEqual(before);
    engine.setControls({ paused: false, speed: 2 });
    advance(engine, 1);
    expect(engine.snapshot().time).toBeCloseTo(1.8, 10);
  });
  it('gives the same result at 30 and 144 rendering FPS', () => {
    const low = new SimulationEngine('fps'),
      high = new SimulationEngine('fps');
    for (let i = 0; i < 30; i++) low.advance(1 / 30);
    for (let i = 0; i < 144; i++) high.advance(1 / 144);
    expect(low.snapshot().steps).toEqual(high.snapshot().steps);
    expect(low.snapshot().bodies).toEqual(high.snapshot().bodies);
  });
  it('caps work and records dropped time instead of creating a catch-up spiral', () => {
    const engine = new SimulationEngine('cap', {
      adaptive: false,
      config: { maxStepsPerFrame: 5 },
    });
    engine.setControls({ speed: 20 });
    engine.advance(100);
    expect(engine.snapshot().steps).toBe(5);
    expect(engine.snapshot().droppedTime).toBeGreaterThan(100);
    const before = engine.snapshot().steps;
    engine.advance(0.001);
    expect(engine.snapshot().steps - before).toBeLessThanOrEqual(5);
  });
  it('records collisions, resets years, retains history and uses a new reproducible seed', () => {
    const engine = new SimulationEngine('first', { generator: collidingGenerator });
    expect(engine.snapshot().reason?.type).toBe('collision');
    advance(engine, 1.9);
    expect(engine.snapshot().restartCount).toBe(0);
    advance(engine, 0.2);
    const snapshot = engine.snapshot();
    expect(snapshot.restartCount).toBe(1);
    expect(snapshot.seed).not.toBe('first');
    expect(snapshot.years).toBe(0);
    expect(snapshot.events.some((e) => e.seed === 'first' && e.type === 'ended')).toBe(true);
    const second = new SimulationEngine('first', { generator: collidingGenerator });
    advance(second, 2.1);
    expect(second.snapshot().seed).toBe(snapshot.seed);
  });
  it('honors disabled auto-restart and manual reset', () => {
    const engine = new SimulationEngine('first', { generator: collidingGenerator });
    engine.setControls({ autoRestart: false });
    advance(engine, 20);
    expect(engine.snapshot().restartCount).toBe(0);
    engine.reset('manual');
    expect(engine.snapshot().seed).toBe('manual');
    expect(engine.snapshot().restartCount).toBe(1);
  });
  it('circuit-breaks repeated failed generations and manual reset clears protection', () => {
    const engine = new SimulationEngine('bad', { generator: collidingGenerator });
    advance(engine, 30);
    expect(engine.snapshot().autoRestartBlocked).toBe(true);
    expect(engine.snapshot().restartCount).toBe(3);
    engine.reset('retry');
    expect(engine.snapshot().autoRestartBlocked).toBe(false);
  });
  it.each(['nonfinite', 'exception'] as const)('recovers from an integrator %s', (mode) => {
    const integrator: Integrator = {
      id: 'fault-injection',
      step: (bodies: Body[]) => {
        if (mode === 'exception') throw new Error('fault');
        bodies[0]!.position[0] = NaN;
      },
    };
    const engine = new SimulationEngine('fault', { integrator });
    engine.advance(0.01);
    expect(engine.snapshot().reason?.type).toBe('numerical');
    advance(engine, 2.1);
    expect(engine.snapshot().restartCount).toBe(1);
    expect(engine.snapshot().events.filter((e) => e.type === 'ended').length).toBeGreaterThan(0);
  });
  it('waits for persistent escape evidence', () => {
    const engine = new SimulationEngine('escape', {
      generator: {
        mode: 'random',
        generate: () => [
          {
            id: 'host',
            name: 'host',
            kind: 'star',
            mass: 1,
            radius: 0.01,
            color: '#fff',
            position: [0, 0, 0],
            velocity: [0, 0, 0],
          },
          {
            id: 'escape',
            name: 'escape',
            kind: 'planet',
            mass: 1e-6,
            radius: 0.001,
            color: '#fff',
            position: [200, 0, 0],
            velocity: [1, 0, 0],
          },
        ],
      },
      config: { escapeConfirmationTime: 0.1 },
    });
    engine.advance(0.1);
    expect(engine.snapshot().phase).toBe('running');
    engine.advance(0.1);
    expect(engine.snapshot().reason?.type).toBe('escape');
  });
  it('rejects invalid physics configuration and speed', () => {
    expect(() => new SimulationEngine('bad', { config: { timeStep: 0 } })).toThrow();
    expect(() => new SimulationEngine().setControls({ speed: NaN })).toThrow();
  });
});

it('galaxy scale preserves the physical clock and does not rescale radii or years', () => {
  const a = new SimulationEngine('physical-year', { config: { galaxyScale: 1 } }),
    b = new SimulationEngine('physical-year', { config: { galaxyScale: 5 } });
  for (let i = 0; i < 100; i++) {
    a.advance(0.01);
    b.advance(0.01);
  }
  expect(a.getTime()).toBeCloseTo(0.6, 10);
  expect(b.getTime()).toBeCloseTo(0.6, 10);
  expect(a.snapshot().years).toBe(b.snapshot().years);
  expect(a.getBodies().map((x) => x.radius)).toEqual(b.getBodies().map((x) => x.radius));
});
