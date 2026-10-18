import { expect, test } from '@playwright/test';
import type { SimulationSnapshot } from '../src/simulation/SimulationEngine';
interface SystemProbe {
  snapshot: SimulationSnapshot | null;
  workers: number;
  maxWorkerMs: number;
}
const read = () => (window as unknown as { __systemProbe: SystemProbe }).__systemProbe;
test('persists galaxy/cage controls, applies similarity on reset and toggles real Worker forces live', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const probe: SystemProbe = { snapshot: null, workers: 0, maxWorkerMs: 0 };
    (window as unknown as { __systemProbe: SystemProbe }).__systemProbe = probe;
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        probe.workers++;
        this.addEventListener('message', (event) => {
          if (event.data.type === 'snapshot') {
            probe.snapshot = event.data.snapshot;
            probe.maxWorkerMs = Math.max(probe.maxWorkerMs, event.data.workerCpuMs);
          }
        });
      }
    };
  });
  await page.goto('./');
  await expect.poll(async () => (await page.evaluate(read)).snapshot?.time ?? 0).toBeGreaterThan(0);
  await page.getByRole('button', { name: '切换设置面板' }).click();
  await page.getByLabel('暂停模拟', { exact: true }).check();
  await page.getByLabel('随机种子 Seed').fill('browser-v03-cage');
  await page.getByRole('button', { name: '应用并重置' }).click();
  await expect.poll(async () => (await page.evaluate(read)).snapshot?.time).toBe(0);
  const initial = (await page.evaluate(read)).snapshot!;
  expect(initial.system?.galaxyScale).toBe(3);
  expect(initial.system?.cage?.enabled).toBe(true);
  await page.getByRole('slider', { name: /星系尺度 Galaxy Scale/ }).fill('1');
  await expect.poll(async () => (await page.evaluate(read)).snapshot?.system?.galaxyScale).toBe(3);
  await page.getByRole('button', { name: '应用尺度并重置' }).click();
  await expect
    .poll(async () => (await page.evaluate(read)).snapshot?.generation)
    .toBe(initial.generation + 1);
  const base = (await page.evaluate(read)).snapshot!;
  await page.getByRole('slider', { name: /星系尺度 Galaxy Scale/ }).fill('5');
  await page.getByRole('button', { name: '应用尺度并重置' }).click();
  await expect
    .poll(async () => (await page.evaluate(read)).snapshot?.generation)
    .toBe(base.generation + 1);
  const scaled = (await page.evaluate(read)).snapshot!;
  expect(scaled.system?.galaxyScale).toBe(5);
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 3; k++) {
      expect(scaled.bodies[i]!.position[k]).toBeCloseTo(base.bodies[i]!.position[k]! * 5, 10);
      expect(scaled.bodies[i]!.velocity[k]).toBeCloseTo(
        base.bodies[i]!.velocity[k]! / Math.sqrt(5),
        10,
      );
      expect(scaled.bodies[i]!.radius).toBe(base.bodies[i]!.radius);
    }
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '切换左右信息面板' }).click();
  await page.getByRole('button', { name: '切换设置面板' }).click();
  await page.getByLabel('引力牢笼总开关', { exact: true }).uncheck();
  await expect
    .poll(async () => (await page.evaluate(read)).snapshot?.system?.diagnosticMode)
    .toBe('newtonian');
  await expect(page.getByLabel('天体与物理统计')).toContainText('纯牛顿引力');
  expect((await page.evaluate(read)).snapshot?.generation).toBe(scaled.generation);
  expect((await page.evaluate(read)).snapshot?.time).toBe(0);
  await page.getByLabel('引力牢笼总开关', { exact: true }).check();
  await expect
    .poll(async () => (await page.evaluate(read)).snapshot?.system?.diagnosticMode)
    .toBe('external-work');
  await expect(page.getByLabel('天体与物理统计')).toContainText('牢笼约束 · 非纯牛顿');
  await expect(page.getByRole('slider', { name: /Mc 约束等效质量/ })).toHaveAttribute(
    'min',
    '100000',
  );
  await expect(page.getByRole('slider', { name: /Mc 约束等效质量/ })).toHaveValue('15000000');
  await page.getByLabel('硬牢笼开关', { exact: true }).check();
  await expect(page.getByRole('slider', { name: /expc 软约束指数/ })).toBeDisabled();
  await expect(page.getByRole('slider', { name: /Rc 硬牢笼约束半径/ })).toBeEnabled();
  await page.getByRole('slider', { name: /rc 外区约束距离/ }).fill('3');
  await page.getByRole('slider', { name: /k1 内区斥力强度/ }).fill('0.2');
  await page.getByLabel('硬牢笼开关', { exact: true }).uncheck();
  await page.getByRole('slider', { name: /expc 软约束指数/ }).fill('2.5');
  await expect
    .poll(async () => (await page.evaluate(read)).snapshot?.system?.cage?.exponent)
    .toBe(2.5);
  expect((await page.evaluate(read)).workers).toBe(1);
  await page.reload();
  await expect.poll(async () => (await page.evaluate(read)).snapshot?.system?.galaxyScale).toBe(5);
  const restored = (await page.evaluate(read)).snapshot!;
  expect(restored.controls.paused).toBe(true);
  expect(restored.system?.cage).toMatchObject({
    enabled: true,
    hard: false,
    rc: 3,
    k1: 0.2,
    exponent: 2.5,
  });
  await page.getByRole('button', { name: '切换左右信息面板' }).click();
  await expect(page.getByLabel('天体与物理统计')).toContainText('牢笼约束 · 非纯牛顿');
  await page.getByRole('button', { name: '切换设置面板' }).click();
  await page.getByRole('slider', { name: /k2 外区约束强度/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-v03-cage.png` });
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '切换左右信息面板' }).click();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-v03-scale5.png` });
  await expect(page.getByRole('alert')).toHaveCount(0);
});
