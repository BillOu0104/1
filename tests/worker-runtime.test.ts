// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { SimulationRuntime } from '../src/simulation/SimulationRuntime';
import { SettingsStore } from '../src/settings/SettingsStore';
import type { PhysicsPort, PhysicsRequest, PhysicsResponse } from '../src/worker/protocol';
import type { SceneRenderer } from '../src/rendering/SceneRenderer';
class FakePort implements PhysicsPort {
  onmessage: ((event: MessageEvent<PhysicsResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  sent: PhysicsRequest[] = [];
  terminate = vi.fn();
  postMessage(message: PhysicsRequest) {
    this.sent.push(message);
  }
  emit(message: PhysicsResponse) {
    this.onmessage?.({ data: message } as MessageEvent<PhysicsResponse>);
  }
  fail() {
    this.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent);
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const setup = () => {
  let frame: FrameRequestCallback | undefined,
    hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frame = cb;
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    frame = undefined;
  });
  const ports: FakePort[] = [],
    store = new SettingsStore(),
    runtime = new SimulationRuntime(store, {
      workerFactory: () => {
        const p = new FakePort();
        ports.push(p);
        return p;
      },
    });
  const advance = vi.spyOn(runtime.engine, 'advance'),
    renderer = { render: vi.fn(), setTermination: vi.fn(), appendTrails: vi.fn() },
    detach = runtime.attach(renderer as unknown as SceneRenderer);
  return {
    ports,
    store,
    runtime,
    advance,
    renderer,
    detach,
    frame: (time: number) => {
      const cb = frame;
      frame = undefined;
      cb?.(time);
    },
    hide: (value: boolean) => {
      hidden = value;
      document.dispatchEvent(new Event('visibilitychange'));
    },
  };
};
it('keeps physics off the UI thread, bounds in-flight requests, resets through the same port and drops hidden time', () => {
  const s = setup(),
    p = s.ports[0]!;
  const trails = { generation: 1, bodyIds: ['planet'], points: new Float64Array([0, 0, 1, 2, 3]) };
  p.emit({ type: 'snapshot', snapshot: s.runtime.engine.snapshot(), workerCpuMs: 0.1, trails });
  expect(s.renderer.appendTrails).toHaveBeenCalledWith(trails, expect.any(Array));
  s.frame(0);
  s.frame(40);
  s.frame(80);
  s.frame(120);
  expect(p.sent.filter((m) => m.type === 'tick')).toHaveLength(1);
  expect(s.advance).not.toHaveBeenCalled();
  const tick = p.sent.find(
    (m): m is Extract<PhysicsRequest, { type: 'tick' }> => m.type === 'tick',
  )!;
  p.emit({
    type: 'snapshot',
    snapshot: s.runtime.engine.snapshot(),
    sequence: tick.sequence,
    workerCpuMs: 0.1,
  });
  const events = s.runtime.getSnapshot().events;
  p.emit({
    type: 'snapshot',
    snapshot: { ...s.runtime.engine.snapshot(), events: [] },
    workerCpuMs: 0,
    eventsUnchanged: true,
  });
  s.runtime.publish();
  expect(s.runtime.getSnapshot().events).toEqual(events);
  s.runtime.reset();
  expect(p.sent.at(-1)?.type).toBe('reset');
  expect(s.ports).toHaveLength(1);
  s.hide(true);
  s.hide(false);
  s.frame(100000);
  expect(p.sent.filter((m) => m.type === 'tick')).toHaveLength(1);
  s.frame(100040);
  expect(p.sent.filter((m) => m.type === 'tick')).toHaveLength(2);
  expect(s.renderer.render).toHaveBeenCalled();
  s.detach();
  expect(p.terminate).toHaveBeenCalled();
});
it('does not let an unsequenced controls acknowledgment release an in-flight physics tick', () => {
  const s = setup(),
    p = s.ports[0]!;
  p.emit({ type: 'snapshot', snapshot: s.runtime.engine.snapshot(), workerCpuMs: 0 });
  s.frame(0);
  s.frame(40);
  s.store.set('trailLengthYears', 1);
  p.emit({ type: 'snapshot', snapshot: s.runtime.engine.snapshot(), workerCpuMs: 0 });
  s.frame(80);
  s.frame(120);
  expect(p.sent.filter((m) => m.type === 'tick')).toHaveLength(1);
  s.detach();
});
it('recovers Worker faults with history, ignores stale messages, and circuit-breaks repeated failures', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const s = setup(),
    old = s.ports[0]!;
  old.fail();
  expect(s.runtime.getSnapshot().reason?.type).toBe('numerical');
  vi.advanceTimersByTime(2000);
  expect(s.ports).toHaveLength(2);
  const before = s.runtime.getSnapshot();
  old.emit({ type: 'snapshot', snapshot: s.runtime.engine.snapshot(), workerCpuMs: 0 });
  expect(s.runtime.getSnapshot()).toBe(before);
  s.ports[1]!.fail();
  vi.advanceTimersByTime(2000);
  s.ports[2]!.fail();
  expect(s.runtime.getSnapshot().autoRestartBlocked).toBe(true);
  expect(s.runtime.getSnapshot().events.filter((e) => e.type === 'ended')).toHaveLength(3);
  vi.advanceTimersByTime(10000);
  expect(s.ports).toHaveLength(3);
  s.runtime.reset();
  expect(s.ports).toHaveLength(4);
  s.detach();
});
it('resumes a deferred Worker recovery after visibility returns', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const s = setup();
  s.ports[0]!.fail();
  s.hide(true);
  vi.advanceTimersByTime(2000);
  expect(s.ports).toHaveLength(1);
  s.hide(false);
  vi.advanceTimersByTime(2000);
  expect(s.ports).toHaveLength(2);
  s.detach();
});
