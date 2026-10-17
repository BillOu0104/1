// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { SimulationRuntime } from '../src/simulation/SimulationRuntime';
import { SettingsStore } from '../src/settings/SettingsStore';
import type { SceneRenderer } from '../src/rendering/SceneRenderer';
afterEach(() => vi.restoreAllMocks());
it('stops hidden frames, discards hidden elapsed time, syncs settings and detaches', () => {
  let scheduled: FrameRequestCallback | undefined,
    hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    scheduled = cb;
    return 1;
  });
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    scheduled = undefined;
  });
  const renderer = { render: vi.fn() },
    settings = new SettingsStore(),
    runtime = new SimulationRuntime(settings);
  const detach = runtime.attach(renderer as unknown as SceneRenderer);
  const frame = (time: number) => {
    const callback = scheduled;
    scheduled = undefined;
    callback?.(time);
  };
  frame(0);
  frame(100);
  expect(runtime.engine.getTime()).toBeCloseTo(0.06, 10);
  hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  expect(scheduled).toBeUndefined();
  hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  frame(60000);
  expect(runtime.engine.getTime()).toBeCloseTo(0.06, 10);
  settings.set('paused', true);
  frame(60100);
  expect(runtime.engine.getTime()).toBeCloseTo(0.06, 10);
  settings.set('paused', false);
  settings.set('speed', 2);
  frame(60200);
  expect(runtime.engine.getTime()).toBeCloseTo(0.18, 10);
  runtime.setHostPaused(true);
  frame(60300);
  expect(runtime.engine.getTime()).toBeCloseTo(0.18, 10);
  detach();
  expect(cancel).toHaveBeenCalled();
  expect(scheduled).toBeUndefined();
});
