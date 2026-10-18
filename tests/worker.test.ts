import { DEFAULT_CAGE } from '../src/physics/cage';
import { RandomInitializer } from '../src/physics/initialConditions';
import { expect, it, vi } from 'vitest';
import { PhysicsWorkerController } from '../src/worker/PhysicsWorkerController';
import type { PhysicsResponse } from '../src/worker/protocol';
const setup = () => {
  const messages: PhysicsResponse[] = [];
  const controller = new PhysicsWorkerController((m) => messages.push(m));
  const latest = () => messages.filter((m) => m.type === 'snapshot').at(-1)!;
  return { controller, messages, latest };
};
it('starts Random immediately at zero with no screening timers, honors visibility/pause and mass changes', () => {
  const timer = vi.spyOn(globalThis, 'setTimeout');
  const { controller, messages, latest } = setup();
  const controls = { paused: true, speed: 1, autoRestart: true };
  controller.receive({ type: 'init', seed: 'worker-test', masses: [1, 0.95, 0.9], controls });
  expect(messages[0]?.type).toBe('snapshot');
  expect(latest().snapshot.time).toBe(0);
  expect(latest().snapshot.screening).toBeUndefined();
  expect(latest().trails?.points.length).toBe(20);
  controller.receive({ type: 'tick', elapsed: 0.2, sequence: 1 });
  expect(latest().snapshot.time).toBe(0);
  controller.receive({ type: 'controls', controls: { ...controls, paused: false } });
  controller.receive({ type: 'visibility', active: false });
  controller.receive({ type: 'tick', elapsed: 0.2, sequence: 2 });
  expect(latest().snapshot.time).toBe(0);
  controller.receive({ type: 'visibility', active: true });
  controller.receive({ type: 'tick', elapsed: 0.2, sequence: 3 });
  expect(latest().snapshot.time).toBeGreaterThan(0);
  const generation = latest().snapshot.generation;
  for (let i = 1; i <= 12; i++) {
    controller.receive({ type: 'reset', seed: `reset-${i}`, masses: [1.1, 0.94, 0.12] });
    const { snapshot, trails } = latest();
    expect(snapshot.time).toBe(0);
    expect(snapshot.generation).toBe(generation + i);
    expect(snapshot.restartCount).toBe(i);
    expect(snapshot.bodies[2]!.mass).toBeLessThan(0.13);
    expect(trails?.generation).toBe(snapshot.generation);
    expect(trails?.points.length).toBe(20);
    expect(trails?.points[1]).toBe(0);
  }
  expect(timer).not.toHaveBeenCalled();
  timer.mockRestore();
  controller.dispose();
  const count = messages.length;
  controller.receive({ type: 'tick', elapsed: 1, sequence: 4 });
  expect(messages.length).toBe(count);
});
it('rejects malformed requests and transfers trajectory buffers rather than cloning history', () => {
  const send = vi.fn();
  const controller = new PhysicsWorkerController(send);
  controller.receive({
    type: 'init',
    seed: 'same',
    masses: [1, 0.95, 0.9],
    controls: { paused: false, speed: 100, autoRestart: true },
  });
  // Test transfer semantics independently of how many steps a loaded CI host fits in 4ms.
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  try {
    controller.receive({ type: 'tick', elapsed: 0.1, sequence: 1 });
  } finally {
    clock.mockRestore();
  }
  const [message, transfers] = send.mock.calls.at(-1)!;
  expect(message.trails.points.length).toBeGreaterThan(20);
  expect(transfers).toEqual([message.trails.points.buffer]);
  controller.receive({ type: 'reset', seed: 'invalid', masses: [NaN] });
  expect(send.mock.calls.at(-1)![0].type).toBe('error');
});
it('keeps one controller through repeated collision restarts with clean batches and circuit protection', () => {
  const generate = RandomInitializer.prototype.generate;
  const spy = vi.spyOn(RandomInitializer.prototype, 'generate').mockImplementation(function (
    this: RandomInitializer,
    seed,
    config,
  ) {
    const bodies = generate.call(this, seed, config);
    bodies[1]!.position = [...bodies[0]!.position];
    return bodies;
  });
  const { controller, latest } = setup();
  controller.receive({
    type: 'init',
    seed: 'restart-soak',
    masses: [1, 0.95, 0.9],
    controls: { paused: false, speed: 100, autoRestart: true },
  });
  let generation = latest().snapshot.generation,
    restarts = 0;
  for (let i = 0; i < 1200 && restarts < 3; i++) {
    controller.receive({ type: 'tick', elapsed: 0.25, sequence: i });
    const { snapshot, trails } = latest();
    expect(trails?.generation).toBe(snapshot.generation);
    expect(trails!.points.length).toBeLessThanOrEqual(4 * 258 * 5);
    if (snapshot.generation !== generation) {
      restarts++;
      expect(snapshot.time).toBe(0);
      expect(trails?.points.length).toBe(20);
      expect(trails?.points[1]).toBe(0);
      generation = snapshot.generation;
    }
  }
  expect(restarts).toBe(3);
  expect(latest().snapshot.restartCount).toBe(3);
  expect(latest().snapshot.run.autoRestarts).toBe(3);
  spy.mockRestore();
  controller.dispose();
});

it('applies fixed competition controls atomically when resetting from random mode', () => {
  const generate = RandomInitializer.prototype.generate;
  const spy = vi.spyOn(RandomInitializer.prototype, 'generate').mockImplementation(function (
    this: RandomInitializer,
    seed,
    config,
  ) {
    const bodies = generate.call(this, seed, config);
    bodies[1]!.position = [...bodies[0]!.position];
    return bodies;
  });
  try {
    const { controller, latest } = setup();
    controller.receive({
      type: 'init',
      seed: 'random-first',
      seedMode: 'random',
      masses: [1, 0.95, 0.9],
      controls: { paused: false, speed: 100, autoRestart: true },
    });
    controller.receive({
      type: 'reset',
      seed: 'competition',
      seedMode: 'fixed',
      masses: [1, 0.95, 0.9],
      controls: { paused: false, speed: 100, autoRestart: true, maxRestarts: 1 },
    });
    for (let i = 0; i < 200; i++) controller.receive({ type: 'tick', elapsed: 0.25, sequence: i });
    expect(latest().snapshot.run.autoRestarts).toBe(1);
    expect(latest().snapshot.run.round).toBe(2);
    expect(latest().snapshot.restartLimitReached).toBe(true);
    expect(latest().trails!.generation).toBe(latest().snapshot.generation);
    controller.dispose();
  } finally {
    spy.mockRestore();
  }
});

it('applies scale on reset and cage settings live, preserving years/generation and physical units', () => {
  const { controller, latest } = setup();
  controller.receive({
    type: 'init',
    seed: 'scale-live',
    masses: [1, 0.95, 0.9],
    galaxyScale: 1,
    cage: { ...DEFAULT_CAGE, enabled: false },
    controls: { paused: true, speed: 1, autoRestart: true },
  });
  const original = latest().snapshot;
  controller.receive({
    type: 'configure',
    galaxyScale: 5,
    cage: { ...DEFAULT_CAGE, enabled: true },
  });
  expect(latest().snapshot.system?.galaxyScale).toBe(1);
  expect(latest().snapshot.system?.cage?.enabled).toBe(true);
  expect(latest().snapshot.generation).toBe(original.generation);
  expect(latest().snapshot.time).toBe(original.time);
  controller.receive({ type: 'reset', seed: 'scale-live', masses: [1, 0.95, 0.9], galaxyScale: 5 });
  const scaled = latest().snapshot;
  expect(scaled.system?.galaxyScale).toBe(5);
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 3; k++) {
      expect(scaled.bodies[i]!.position[k]).toBeCloseTo(original.bodies[i]!.position[k]! * 5, 12);
      expect(scaled.bodies[i]!.velocity[k]).toBeCloseTo(
        original.bodies[i]!.velocity[k]! / Math.sqrt(5),
        12,
      );
    }
  controller.receive({
    type: 'configure',
    galaxyScale: 5,
    cage: { ...DEFAULT_CAGE, enabled: false },
  });
  expect(latest().snapshot.system?.diagnosticMode).toBe('newtonian');
  expect(latest().snapshot.generation).toBe(scaled.generation);
  controller.dispose();
});
