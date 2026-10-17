// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
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
    const generation = runtime.engine.getGeneration();
    fireEvent.change(screen.getByRole('slider', { name: /尾迹长度 Trail Length/ }), {
      target: { value: '0.4' },
    });
    expect(settings.getSnapshot().trailLengthYears).toBe(0.4);
    expect(runtime.engine.getGeneration()).toBe(generation);
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
