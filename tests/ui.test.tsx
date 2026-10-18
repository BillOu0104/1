// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsStore } from '../src/settings/SettingsStore';
import { SimulationRuntime } from '../src/simulation/SimulationRuntime';
import { App } from '../src/ui/App';
vi.mock('../src/ui/components/SimulationScene', () => ({
  SimulationScene: () => <div data-testid="scene" />,
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('observatory UI', () => {
  it('shows the retained final result instead of a restart countdown at the competition limit', async () => {
    const store = new SettingsStore();
    store.set('seedMode', 'fixed');
    store.set('unlimitedRestarts', false);
    store.set('maxRestarts', 0);
    const runtime = new SimulationRuntime(store, { synchronous: true });
    render(<App runtime={runtime} />);
    act(() => {
      const bodies = runtime.engine.getBodies();
      bodies[1]!.position = [...bodies[0]!.position];
      runtime.engine.advance(0.1);
      runtime.publish();
    });
    expect(screen.getByText('已达到最大自动重置次数，本场已结束；结果已保留')).toBeVisible();
    expect(screen.queryByText(/下一轮将在/)).not.toBeInTheDocument();
    expect(runtime.getSnapshot().run.lastEndReason?.type).toBe('collision');
  });
  it('uses fresh startup/reset Seeds by default and can replay the recorded Seed', async () => {
    const settings = new SettingsStore();
    const runtime = new SimulationRuntime(settings, { synchronous: true });
    const first = runtime.getSnapshot();
    expect(new SimulationRuntime(settings, { synchronous: true }).getSnapshot().seed).not.toBe(
      first.seed,
    );
    render(<App runtime={runtime} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '切换设置面板' }));
    expect(screen.queryByLabelText('随机种子 Seed')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /手动重置/ }));
    const second = runtime.getSnapshot();
    expect(second.seed).not.toBe(first.seed);
    expect(second.bodies).not.toEqual(first.bodies);
    await user.selectOptions(screen.getByLabelText('Seed 模式'), 'fixed');
    fireEvent.change(screen.getByRole('slider', { name: /星系尺度 Galaxy Scale/ }), {
      target: { value: '7' },
    });
    fireEvent.change(screen.getByRole('slider', { name: /恒星 A 参考质量/ }), {
      target: { value: '2.5' },
    });
    await user.click(screen.getByRole('button', { name: '重新运行当前 Seed' }));
    expect(runtime.getSnapshot().seed).toBe(second.seed);
    expect(runtime.getSnapshot().bodies).toEqual(second.bodies);
    expect(settings.getSnapshot().seed).toBe(second.seed);
    expect(runtime.getSnapshot().run.autoRestarts).toBe(0);
  });
  it('hides both info panels initially, toggles them together without changing physics', async () => {
    const runtime = new SimulationRuntime(new SettingsStore(), { synchronous: true }),
      user = userEvent.setup();
    render(<App runtime={runtime} />);
    expect(screen.getByLabelText('行星与事件信息')).not.toBeVisible();
    expect(screen.getByLabelText('天体与物理统计')).not.toBeVisible();
    await user.click(screen.getByRole('button', { name: '切换左右信息面板' }));
    expect(screen.getByLabelText('行星与事件信息')).toBeVisible();
    expect(screen.getByLabelText('天体与物理统计')).toBeVisible();
    expect(runtime.engine.snapshot().controls.paused).toBe(false);
    await user.click(screen.getByRole('button', { name: '切换左右信息面板' }));
    expect(screen.getByLabelText('行星与事件信息')).not.toBeVisible();
  });
  it('opens settings, changes controls, applies seed, resets and closes on Escape', async () => {
    const settings = new SettingsStore(),
      runtime = new SimulationRuntime(settings, { synchronous: true }),
      user = userEvent.setup();
    render(<App runtime={runtime} />);
    expect(screen.queryByLabelText('模拟设置')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '切换设置面板' }));
    await user.click(screen.getByLabelText('暂停模拟'));
    expect(settings.getSnapshot().paused).toBe(true);
    await user.click(screen.getByLabelText('自动重启'));
    expect(settings.getSnapshot().autoRestart).toBe(false);
    await user.click(screen.getByLabelText('显示轨迹'));
    expect(settings.getSnapshot().trails).toBe(false);
    fireEvent.change(screen.getByRole('slider', { name: /星系尺度 Galaxy Scale/ }), {
      target: { value: '5' },
    });
    expect(settings.getSnapshot().galaxyScale).toBe(5);
    expect(runtime.engine.snapshot().system?.galaxyScale).toBe(3);
    await user.click(screen.getByRole('button', { name: '应用尺度并重置' }));
    expect(runtime.engine.snapshot().system?.galaxyScale).toBe(5);
    await user.click(screen.getByLabelText('引力牢笼总开关'));
    expect(settings.getSnapshot().cageEnabled).toBe(false);
    await user.click(screen.getByLabelText('引力牢笼总开关'));
    expect(settings.getSnapshot().cageEnabled).toBe(true);
    const scaledGeneration = runtime.engine.getGeneration();
    fireEvent.change(screen.getByRole('slider', { name: /尾迹长度 Trail Length/ }), {
      target: { value: '0.4' },
    });
    expect(settings.getSnapshot().trailLengthYears).toBe(0.4);
    expect(runtime.engine.getGeneration()).toBe(scaledGeneration);
    await user.selectOptions(screen.getByLabelText('Seed 模式'), 'fixed');
    const seed = screen.getByLabelText('随机种子 Seed');
    await user.clear(seed);
    await user.type(seed, 'kepler-test');
    await user.click(screen.getByRole('button', { name: '应用并重置' }));
    expect(runtime.engine.snapshot().seed).toBe('kepler-test');
    const before = runtime.engine.snapshot().restartCount;
    await user.click(screen.getByRole('button', { name: /手动重置/ }));
    expect(runtime.engine.snapshot().restartCount).toBe(before + 1);
    fireEvent.change(screen.getByRole('slider', { name: /恒星 A 参考质量/ }), {
      target: { value: '1.25' },
    });
    await user.click(screen.getByRole('button', { name: '应用质量并重置' }));
    expect(settings.getSnapshot().massA).toBe(1.25);
    expect(runtime.engine.getBodies()[0]!.mass).toBeGreaterThan(1.21);
    expect(runtime.engine.getBodies()[0]!.mass).toBeLessThan(1.29);
    expect(screen.getByText('扩展模块与开发状态')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('模拟设置')).not.toBeInTheDocument();
  });
});
