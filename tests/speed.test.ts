import { expect, it } from 'vitest';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { DEFAULT_CAGE } from '../src/physics/cage';
import { TrajectoryRecorder } from '../src/physics/trajectory';

it.each(['speed-0', 'speed-1', 'speed-2', 'speed-3'])(
  'keeps identical accepted physics and trajectory samples at 20× and 100× (%s)',
  (seed) => {
    const trails = [new TrajectoryRecorder(), new TrajectoryRecorder()];
    const engines = [20, 100].map((speed, i) => {
      const engine = new SimulationEngine(seed, {
        config: { galaxyScale: 3, cage: { ...DEFAULT_CAGE } },
        onAcceptedState: (bodies, time, generation) => trails[i]!.capture(bodies, time, generation),
      });
      engine.setControls({ speed, autoRestart: false });
      return engine;
    });
    for (let i = 0; i < 100; i++) {
      engines[0]!.advance(0.2);
      engines[1]!.advance(0.04);
      // Production drains after each Worker request; never accumulate many requests into one batch.
      expect(trails[1]!.drain().points).toEqual(trails[0]!.drain().points);
    }
    const [slow, fast] = engines.map((e) => e.snapshot());
    expect(fast!.integrator).toBe('dopri5-adaptive');
    expect(fast!.time).toBe(slow!.time);
    expect(fast!.bodies).toEqual(slow!.bodies);
    expect(fast!.relativeEnergyError).toBe(slow!.relativeEnergyError);
    expect(fast!.diagnostics.angularMomentumError).toBe(slow!.diagnostics.angularMomentumError);
    expect(fast!.reason).toEqual(slow!.reason);
  },
);

it('reports target versus achieved speed when step budgets prevent 100×', () => {
  const engine = new SimulationEngine('limited-100', { config: { maxStepsPerFrame: 1 } });
  engine.setControls({ speed: 100 });
  for (let i = 0; i < 100; i++) engine.advance(0.1);
  const snapshot = engine.snapshot();
  expect(snapshot.controls.speed).toBe(100);
  expect(snapshot.diagnostics.achievedSpeed).toBeGreaterThan(0);
  expect(snapshot.diagnostics.achievedSpeed).toBeLessThan(100);
  expect(snapshot.droppedTime).toBeGreaterThan(0);
  expect(snapshot.diagnostics.limited).toBe(true);
  expect(snapshot.relativeEnergyError).toBeLessThan(1e-5);
  engine.setControls({ paused: true });
  expect(engine.snapshot().diagnostics.achievedSpeed).toBe(0);
});

it('includes active wall time discarded by the request cap in achieved speed', () => {
  const engine = new SimulationEngine('true-wall', {
    config: { galaxyScale: 3, cage: { ...DEFAULT_CAGE } },
  });
  engine.setControls({ speed: 100, autoRestart: false });
  for (let i = 0; i < 10; i++) engine.advance(0.1, Infinity, 1);
  expect(engine.snapshot().controls.speed).toBe(100);
  expect(engine.snapshot().diagnostics.achievedSpeed).toBeGreaterThan(9);
  expect(engine.snapshot().diagnostics.achievedSpeed).toBeLessThan(11);
});
