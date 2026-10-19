import { expect, it, vi } from 'vitest';
import { PhysicsWorkerController } from '../src/worker/PhysicsWorkerController';
import type { PhysicsResponse } from '../src/worker/protocol';
import { V04_DEFAULTS } from '../src/environment/config';
import { DEFAULT_CAGE } from '../src/physics/cage';
function replay(speed: number) {
  const messages: PhysicsResponse[] = [];
  const w = new PhysicsWorkerController((m) => messages.push(m));
  w.receive({
    type: 'init',
    seed: 'v04-repro',
    seedMode: 'fixed',
    masses: [1, 0.95, 0.9],
    environment: V04_DEFAULTS,
    galaxyScale: 3,
    cage: { ...DEFAULT_CAGE },
    controls: { paused: false, speed, autoRestart: false },
  });
  for (let i = 0; i < 100; i++) w.receive({ type: 'tick', sequence: i, elapsed: 0.2 / speed });
  // Full history can be omitted on unchanged emits: request a new valid generation to check reset separately.
  const last = messages.filter((m) => m.type === 'snapshot').at(-1)!;
  return { w, messages, last };
}
it('reproduces full accepted physics and civilization events at 1× and 100× without changing integrator accuracy', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  try {
    const a = replay(1),
      b = replay(100);
    const states = (messages: PhysicsResponse[]) =>
      messages
        .filter((m) => m.type === 'snapshot')
        .map((m) => ({
          bodies: m.snapshot.bodies,
          time: m.snapshot.time,
          reason: m.snapshot.reason,
          energyError: m.snapshot.relativeEnergyError,
          environment: m.snapshot.environment,
          trails: m.trails,
        }));
    expect(states(a.messages)).toEqual(states(b.messages));
    expect(b.last.snapshot.integrator).toMatch(/dopri/i);
    expect(b.last.snapshot.environment!.physicalYear).toBe(b.last.snapshot.years);
    a.w.dispose();
    b.w.dispose();
  } finally {
    clock.mockRestore();
  }
});
it('honors visibility/pause and resets only universe histories while keeping session ranking and one controller', () => {
  const { w, last } = replay(100),
    old = last.snapshot;
  const messages: PhysicsResponse[] = [];
  const c = new PhysicsWorkerController((m) => messages.push(m));
  c.receive({
    type: 'init',
    seed: 'clean',
    masses: [1, 0.95, 0.9],
    environment: V04_DEFAULTS,
    controls: { paused: true, speed: 100, autoRestart: true },
  });
  c.receive({ type: 'tick', sequence: 1, elapsed: 0.2 });
  let s = messages.filter((m) => m.type === 'snapshot').at(-1)!.snapshot;
  expect(s.environment!.physicalYear).toBe(0);
  expect(s.environment!.civilYear).toBe(0);
  for (let i = 0; i < 10; i++)
    c.receive({ type: 'reset', seed: `next-${i}`, masses: [1, 0.95, 0.9] });
  s = messages.filter((m) => m.type === 'snapshot').at(-1)!.snapshot;
  expect(s.environment!.generation).toBe(s.generation);
  expect(s.environment!.records).toHaveLength(0);
  expect(s.environment!.events.every((e) => e.year === 0)).toBe(true);
  expect(old.environment!.seed).toBe('v04-repro');
  w.dispose();
  c.dispose();
});
it('applies environmental parameters live but initial condition changes only at the next reset', () => {
  const messages: PhysicsResponse[] = [];
  const c = new PhysicsWorkerController((m) => messages.push(m));
  const latest = () => messages.filter((m) => m.type === 'snapshot').at(-1)!.snapshot;
  c.receive({
    type: 'init',
    seed: 'config',
    masses: [1, 0.95, 0.9],
    environment: V04_DEFAULTS,
    controls: { paused: true, speed: 1, autoRestart: false },
  });
  const before = latest();
  c.receive({
    type: 'configure',
    galaxyScale: 5,
    cage: { ...DEFAULT_CAGE },
    environment: { ...V04_DEFAULTS, randomPosRange: 3, luminosityA: 3 },
  });
  expect(latest().bodies).toEqual(before.bodies);
  expect(latest().initialization!.environment!.randomPosRange).toBe(2);
  c.receive({ type: 'reset', seed: 'config', masses: [1, 0.95, 0.9] });
  expect(latest().initialization!.environment!.randomPosRange).toBe(3);
  expect(latest().system!.galaxyScale).toBe(5);
  c.dispose();
});
it('boots from the real Runtime session handoff before any civilization exists in the new Worker', () => {
  const messages: PhysicsResponse[] = [];
  const c = new PhysicsWorkerController((m) => messages.push(m));
  c.receive({
    type: 'init',
    seed: 'bootstrap',
    masses: [1, 0.95, 0.9],
    controls: { paused: false, speed: 1, autoRestart: false },
    session: { generation: 1, restartCount: 0, events: [], environment: { ranking: [], total: 0 } },
  });
  expect(messages[0]?.type).toBe('snapshot');
  c.receive({ type: 'tick', elapsed: 0.2, sequence: 1 });
  const last = messages.filter((m) => m.type === 'snapshot').at(-1)!;
  expect(last.snapshot.time).toBeGreaterThan(0);
  expect(last.snapshot.environment!.generation).toBe(2);
  c.dispose();
});
