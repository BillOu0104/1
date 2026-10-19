import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { SimulationSnapshot } from '../src/simulation/SimulationEngine';

interface Probe {
  snapshot: SimulationSnapshot | null;
  workers: number;
  pending: number;
  maxPending: number;
  maxBatch: number;
  cpu: number[];
  longTasks: number[];
  active: boolean;
}
const read = () => (window as unknown as { __v031: Probe }).__v031;

test('random/fixed Seed, precise numeric inputs, aligned masses and bounded 100× Worker operation', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const probe: Probe = {
      snapshot: null,
      workers: 0,
      pending: 0,
      maxPending: 0,
      maxBatch: 0,
      cpu: [],
      longTasks: [],
      active: false,
    };
    (window as unknown as { __v031: Probe }).__v031 = probe;
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        probe.workers++;
        this.addEventListener('message', (event) => {
          if (event.data.type !== 'snapshot') return;
          probe.snapshot = event.data.snapshot;
          if (event.data.sequence !== undefined) probe.pending--;
          probe.maxBatch = Math.max(probe.maxBatch, (event.data.trails?.points.length ?? 0) / 5);
          if (probe.active) probe.cpu.push(event.data.workerCpuMs);
        });
      }
      postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
        if ((message as { type: string }).type === 'tick') {
          probe.pending++;
          probe.maxPending = Math.max(probe.maxPending, probe.pending);
        }
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
    };
    new PerformanceObserver((list) => {
      if (probe.active) for (const e of list.getEntries()) probe.longTasks.push(e.duration);
    }).observe({ type: 'longtask' });
  });
  await page.goto('./');
  await expect.poll(async () => (await page.evaluate(read)).snapshot?.time ?? 0).toBeGreaterThan(0);
  await page.getByRole('button', { name: '切换设置面板' }).click();
  await page.getByLabel('暂停模拟', { exact: true }).check();
  await expect(page.getByLabel('Seed 模式', { exact: true })).toHaveValue('random');
  await expect(page.getByLabel('随机种子 Seed', { exact: true })).toHaveCount(0);
  const original = (await page.evaluate(read)).snapshot!;
  const seeds = [original.seed];
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: /手动重置/ }).click();
    await expect
      .poll(async () => (await page.evaluate(read)).snapshot?.generation)
      .toBe(original.generation + i + 1);
    const current = (await page.evaluate(read)).snapshot!;
    seeds.push(current.seed);
    expect(current.time).toBe(0);
    expect(current.bodies).not.toEqual(original.bodies);
  }
  expect(new Set(seeds).size).toBe(3);

  for (const [name, value] of [
    ['A', '0.99'],
    ['B', '0.94'],
    ['C', '0.12'],
  ]) {
    const input = page.getByRole('spinbutton', {
      name: `恒星 ${name} 参考质量 M☉ 数值`,
      exact: true,
    });
    await input.fill(value!);
    await expect(
      page.getByRole('slider', { name: `恒星 ${name} 参考质量 M☉`, exact: true }),
    ).toHaveValue(value!);
    await input.blur();
    const field = input.locator('xpath=ancestor::div[contains(@class,"range-field")]');
    const layout = await field.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return [...el.querySelectorAll('.numeric-value input, .numeric-unit')].map((node) => {
        const b = node.getBoundingClientRect();
        return {
          left: b.left,
          right: b.right,
          top: b.top,
          bottom: b.bottom,
          parentLeft: r.left,
          parentRight: r.right,
        };
      });
    });
    expect(layout).toHaveLength(2);
    expect(layout[0]!.right - layout[0]!.left).toBeGreaterThanOrEqual(90);
    expect(layout[0]!.right - layout[0]!.left).toBeLessThanOrEqual(100);
    expect(layout[0]!.right).toBeLessThanOrEqual(layout[1]!.left);
    for (const r of layout) {
      expect(r.left).toBeGreaterThanOrEqual(r.parentLeft);
      expect(r.right).toBeLessThanOrEqual(r.parentRight);
    }
    await expect(field.locator('.numeric-unit')).toHaveText('M☉');
  }
  const mass = page.getByRole('spinbutton', { name: '恒星 A 参考质量 M☉ 数值', exact: true });
  await mass.fill('1.234');
  await expect(mass).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('slider', { name: '恒星 A 参考质量 M☉', exact: true })).toHaveValue(
    '0.99',
  );
  await mass.blur();
  await expect(mass).toHaveValue('0.99');
  const numericLayout = await page.locator('.numeric-controls').evaluateAll((fields) =>
    fields.map((field) => {
      const number = field.querySelector<HTMLInputElement>('input[type=number]')!;
      const slider = field.querySelector<HTMLInputElement>('input[type=range]')!;
      const style = getComputedStyle(number);
      const context = document.createElement('canvas').getContext('2d')!;
      context.font = style.font;
      return {
        width: number.getBoundingClientRect().width,
        right: number.getBoundingClientRect().right,
        sliderWidth: slider.getBoundingClientRect().width,
        textWidth: context.measureText(number.value).width,
        textSpace:
          number.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      };
    }),
  );
  expect(numericLayout.length).toBeGreaterThan(10);
  for (const field of numericLayout) {
    expect(field.width).toBe(98);
    expect(field.right).toBeCloseTo(numericLayout[0]!.right, 1);
    expect(field.sliderWidth).toBeGreaterThan(90);
    expect(field.textWidth).toBeLessThanOrEqual(field.textSpace);
  }
  await mass.scrollIntoViewIfNeeded();
  await mass.evaluate((el) => {
    const scroll = document.querySelector('.settings-scroll')!;
    scroll.scrollTop +=
      el.closest('details')!.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
  });
  await page.screenshot({ path: `test-results/${testInfo.project.name}-v031-masses.png` });

  await page.getByLabel('Seed 模式', { exact: true }).selectOption('fixed');
  await page.getByLabel('自动重置次数不限制', { exact: true }).uncheck();
  await page.getByRole('spinbutton', { name: /最大自动重置次数.*数值/ }).fill('0');
  await page.getByLabel('随机种子 Seed', { exact: true }).fill('v031-browser');
  await page.getByRole('button', { name: '应用并重置', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(read)).snapshot?.seed).toBe('v031-browser');
  const fixed = (await page.evaluate(read)).snapshot!;
  expect(fixed.run).toMatchObject({ autoRestarts: 0, round: 1, seedMode: 'fixed' });
  expect(fixed.controls.maxRestarts).toBe(0);
  await page.getByRole('spinbutton', { name: '模拟速度 数值', exact: true }).fill('100');
  await expect(page.getByRole('slider', { name: '模拟速度', exact: true })).toHaveValue('100');
  const before = await page.evaluate(() => {
    const p = (window as unknown as { __v031: Probe }).__v031;
    p.active = true;
    return { time: p.snapshot!.time, wall: performance.now() };
  });
  await page.getByLabel('暂停模拟', { exact: true }).uncheck();
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => {
    const p = (window as unknown as { __v031: Probe }).__v031;
    p.active = false;
    return { probe: p, wall: performance.now() };
  });
  expect(after.probe.snapshot!.controls.speed).toBe(100);
  expect(after.probe.snapshot!.time).toBeGreaterThan(before.time);
  expect(after.probe.snapshot!.diagnostics.achievedSpeed).toBeGreaterThan(0);
  expect(after.probe.snapshot!.reason).toBeNull();
  expect(Math.abs(after.probe.snapshot!.relativeEnergyError)).toBeLessThan(1e-4);
  expect(after.probe.maxPending).toBe(1);
  expect(after.probe.workers).toBe(1);
  expect(after.probe.maxBatch).toBeGreaterThan(4);
  expect(after.probe.maxBatch).toBeLessThanOrEqual(4 * 258);
  const cpu = after.probe.cpu.slice().sort((a, b) => a - b);
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    `test-results/${testInfo.project.name}-v031-performance.json`,
    JSON.stringify(
      {
        viewport: page.viewportSize(),
        targetSpeed: 100,
        sampleMs: after.wall - before.wall,
        achievedSpeed:
          (after.probe.snapshot!.time - before.time) / (((after.wall - before.wall) / 1000) * 0.6),
        displayedAchievedSpeed: after.probe.snapshot!.diagnostics.achievedSpeed,
        workerCpuP95: cpu[Math.floor(cpu.length * 0.95)],
        workerCpuMax: Math.max(...cpu),
        longTasks: after.probe.longTasks,
        maxPending: after.probe.maxPending,
        workers: after.probe.workers,
        maxBatch: after.probe.maxBatch,
        energyError: after.probe.snapshot!.relativeEnergyError,
        angularMomentumError: after.probe.snapshot!.diagnostics.angularMomentumError,
        errors,
      },
      null,
      2,
    ),
  );
  await page.getByLabel('暂停模拟', { exact: true }).check();
  // Replaying this Seed must also restore its inputs instead of applying unapplied drafts.
  await page.getByRole('spinbutton', { name: /星系尺度 Galaxy Scale 数值/ }).fill('7');
  await page.getByRole('spinbutton', { name: '恒星 A 参考质量 M☉ 数值', exact: true }).fill('2.5');
  await page.getByRole('button', { name: '重新运行当前 Seed', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(read)).snapshot?.time).toBe(0);
  expect((await page.evaluate(read)).snapshot!.bodies).toEqual(fixed.bodies);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.reload();
  await expect.poll(async () => (await page.evaluate(read)).snapshot?.controls.speed).toBe(100);
  const restored = (await page.evaluate(read)).snapshot!;
  expect(restored.bodies).toEqual(fixed.bodies);
  expect(restored.controls.maxRestarts).toBe(0);
  expect(restored.run.autoRestarts).toBe(0);
});
