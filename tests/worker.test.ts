import { expect, it } from 'vitest';
import { PhysicsWorkerController } from '../src/worker/PhysicsWorkerController';
import type { PhysicsResponse } from '../src/worker/protocol';
const setup = () => {
  let id = 0;
  const tasks = new Map<number, () => void>(),
    messages: PhysicsResponse[] = [];
  const controller = new PhysicsWorkerController(
    (m) => messages.push(m),
    (fn) => {
      tasks.set(++id, fn);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    (token) => {
      tasks.delete(token as unknown as number);
    },
  );
  const drainUntil = (predicate: () => boolean) => {
    let calls = 0;
    while (!predicate()) {
      const next = tasks.entries().next().value as [number, () => void] | undefined;
      if (!next) throw new Error('No scheduled work');
      tasks.delete(next[0]);
      next[1]();
      if (++calls > 2000) throw new Error('Unbounded work');
    }
  };
  return { controller, tasks, messages, drainUntil };
};
it('selects in background, starts at year zero, freezes hidden/paused work and replaces only initial state', () => {
  const { controller, tasks, messages, drainUntil } = setup();
  const controls = { paused: true, speed: 1, autoRestart: true };
  controller.receive({ type: 'init', seed: 'worker-test', masses: [1, 0.95, 0.9], controls });
  expect(messages[0]?.type).toBe('screening');
  controller.receive({ type: 'visibility', active: false });
  expect(tasks.size).toBe(0);
  controller.receive({ type: 'visibility', active: true });
  drainUntil(() => messages.some((m) => m.type === 'snapshot'));
  let snapshot = messages
    .filter((m): m is Extract<PhysicsResponse, { type: 'snapshot' }> => m.type === 'snapshot')
    .at(-1)!.snapshot;
  expect(snapshot.time).toBe(0);
  expect(snapshot.screening?.candidates).toBe(6);
  expect(tasks.size).toBe(0);
  controller.receive({ type: 'controls', controls: { ...controls, paused: false } });
  expect(tasks.size).toBe(1);
  controller.receive({ type: 'tick', elapsed: 0.2, sequence: 1 });
  snapshot = messages
    .filter((m): m is Extract<PhysicsResponse, { type: 'snapshot' }> => m.type === 'snapshot')
    .at(-1)!.snapshot;
  expect(snapshot.time).toBeGreaterThan(0);
  const generation = snapshot.generation;
  controller.receive({ type: 'reset', seed: 'worker-reset', masses: [1.1, 0.94, 0.12] });
  drainUntil(() =>
    messages.some((m) => m.type === 'snapshot' && m.snapshot.seed === 'worker-reset'),
  );
  snapshot = messages
    .filter((m): m is Extract<PhysicsResponse, { type: 'snapshot' }> => m.type === 'snapshot')
    .at(-1)!.snapshot;
  expect(snapshot.time).toBe(0);
  expect(snapshot.generation).toBe(generation + 1);
  expect(snapshot.restartCount).toBe(1);
  expect(snapshot.bodies[2]!.mass).toBeLessThan(0.13);
  controller.dispose();
  expect(tasks.size).toBe(0);
}, 15000);
it('cancels stale screening on reset and rejects malformed mass requests', () => {
  const { controller, messages, drainUntil, tasks } = setup();
  controller.receive({
    type: 'init',
    seed: 'old',
    masses: [1, 0.95, 0.9],
    controls: { paused: false, speed: 1, autoRestart: true },
  });
  controller.receive({ type: 'reset', seed: 'new', masses: [1, 0.95, 0.9] });
  drainUntil(() => messages.some((m) => m.type === 'snapshot'));
  expect(
    messages.filter((m) => m.type === 'snapshot').every((m) => m.snapshot.seed === 'new'),
  ).toBe(true);
  controller.receive({ type: 'reset', seed: 'invalid', masses: [NaN] });
  expect(messages.at(-1)?.type).toBe('error');
  controller.dispose();
  expect(tasks.size).toBe(0);
}, 15000);
