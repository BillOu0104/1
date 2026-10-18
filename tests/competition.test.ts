import { expect, it } from 'vitest';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { RandomInitializer } from '../src/physics/initialConditions';
import { createRandomSeed } from '../src/simulation/seeds';
import type { InitialConditionGenerator } from '../src/physics/types';

const generator: InitialConditionGenerator = {
  mode: 'random',
  generate(seed, config) {
    const bodies = new RandomInitializer().generate(seed, config);
    bodies[1]!.position = [...bodies[0]!.position];
    return bodies;
  },
};
const seconds = (engine: SimulationEngine, count = 30) => {
  for (let i = 0; i < count * 4; i++) engine.advance(0.25);
};

it.each([0, 1, 2])(
  'allows exactly %i automatic restarts and retains the final result indefinitely',
  (limit) => {
    const engine = new SimulationEngine('race', { generator });
    engine.setControls({ speed: 100, maxRestarts: limit });
    seconds(engine);
    const last = engine.snapshot();
    expect(last.run.autoRestarts).toBe(limit);
    expect(last.run.round).toBe(limit + 1);
    expect(last.restartCount).toBe(limit);
    expect(last.phase).toBe('ended');
    expect(last.restartLimitReached).toBe(true);
    expect(last.autoRestartBlocked).toBe(false);
    expect(last.run.lastEndReason?.type).toBe('collision');
    seconds(engine, 60);
    expect(engine.snapshot().seed).toBe(last.seed);
    expect(engine.snapshot().events).toEqual(last.events);
    expect(engine.snapshot().run).toEqual(last.run);
    engine.reset('race');
    expect(engine.snapshot().run).toMatchObject({ autoRestarts: 0, round: 1, rootSeed: 'race' });
    seconds(engine);
    expect(engine.snapshot().seed).toBe(last.seed);
  },
);

it('uses reproducible fixed sequences and exact initial conditions when replaying any round', () => {
  const a = new SimulationEngine('race', { generator }),
    b = new SimulationEngine('race', { generator });
  a.setControls({ maxRestarts: 2 });
  b.setControls({ maxRestarts: 2 });
  seconds(a);
  seconds(b);
  expect(a.snapshot().bodies).toEqual(b.snapshot().bodies);
  expect(a.snapshot().seed).toBe(b.snapshot().seed);
  const seed = a.snapshot().seed;
  const initial = new SimulationEngine(seed).snapshot().bodies;
  const replay = new SimulationEngine(seed);
  seconds(replay, 1);
  replay.reset(seed);
  expect(replay.snapshot().bodies).toEqual(initial);
});

it('draws fresh random entropy on manual and automatic resets without honoring fixed-only limits', () => {
  const seeds = new Set(Array.from({ length: 100 }, () => createRandomSeed()));
  expect(seeds.size).toBe(100);
  const engine = new SimulationEngine(createRandomSeed(), { seedMode: 'random', generator });
  engine.setControls({ maxRestarts: 0 });
  const initial = engine.snapshot().seed;
  seconds(engine, 2.25);
  expect(engine.snapshot().run.autoRestarts).toBe(1);
  expect(engine.snapshot().seed).not.toBe(initial);
  const second = engine.snapshot().seed;
  engine.reset();
  expect(engine.snapshot().seed).not.toBe(second);
  expect(engine.snapshot().run.autoRestarts).toBe(0);
});

it('retains the longest live or ended round, its Seed, and the last reason across automatic rounds', () => {
  const engine = new SimulationEngine('longest');
  seconds(engine, 2);
  const years = engine.snapshot().years;
  expect(engine.snapshot().run.longestYears).toBe(years);
  const bodies = engine.getBodies();
  bodies[1]!.position = [...bodies[0]!.position];
  engine.advance(0.1);
  expect(engine.snapshot().run.lastEndReason?.type).toBe('collision');
  seconds(engine, 2.25);
  expect(engine.snapshot().run.autoRestarts).toBe(1);
  expect(engine.snapshot().run.longestSeed).toBe('longest');
  expect(engine.snapshot().run.longestYears).toBe(years);
  expect(engine.snapshot().run.lastEndReason?.type).toBe('collision');
  engine.reset('new-competition');
  expect(engine.snapshot().run.longestYears).toBe(0);
  expect(engine.snapshot().run.lastEndReason).toBeNull();
});

it('validates safe integer restart limits and the 100× target', () => {
  const engine = new SimulationEngine('limits');
  for (const maxRestarts of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(() => engine.setControls({ maxRestarts })).toThrow();
  for (const speed of [100.1, NaN, Infinity]) expect(() => engine.setControls({ speed })).toThrow();
  expect(() => engine.setControls({ speed: 100, maxRestarts: null })).not.toThrow();
});
