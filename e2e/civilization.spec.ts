import { expect, test } from '@playwright/test';
import type { SimulationSnapshot } from '../src/simulation/SimulationEngine';
test('live Worker temperature/civilizations, persisted original controls and 100× pause/replay', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const Native = window.Worker;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (e) => {
          if (e.data.type === 'snapshot')
            (window as unknown as { __civil: SimulationSnapshot }).__civil = e.data.snapshot;
        });
      }
    };
  });
  const snapshot = () =>
    page.evaluate(() => (window as unknown as { __civil: SimulationSnapshot }).__civil);
  await page.goto('./');
  await expect.poll(async () => (await snapshot())?.time ?? 0).toBeGreaterThan(0);
  await page.getByRole('button', { name: '切换左右信息面板' }).click();
  await expect(page.getByTestId('planet-temperature')).toBeVisible();
  await expect(page.getByLabel('文明实时状态')).toBeVisible();
  await page.getByRole('button', { name: '切换设置面板' }).click();
  await page.getByLabel('暂停模拟', { exact: true }).check();
  await expect.poll(async () => (await snapshot()).controls.paused).toBe(true);
  const paused = (await snapshot()).environment!;
  await page.waitForTimeout(200);
  expect((await snapshot()).environment).toEqual(paused);
  await page.getByText('原版初始条件', { exact: true }).click();
  const pos = page.getByRole('spinbutton', { name: 'Random Pos Range 数值', exact: true });
  await pos.fill('2.5');
  await pos.blur();
  await expect(page.getByRole('slider', { name: 'Random Pos Range', exact: true })).toHaveValue(
    '2.5',
  );
  await page.getByLabel('Seed 模式', { exact: true }).selectOption('fixed');
  await page.getByLabel('随机种子 Seed', { exact: true }).fill('v04-browser');
  await page.getByRole('button', { name: '应用并重置' }).click();
  await expect.poll(async () => (await snapshot()).seed).toBe('v04-browser');
  const initial = (await snapshot()).bodies;
  await page.getByText('文明排行', { exact: true }).click();
  await page.getByLabel('显示文明排行', { exact: true }).check();
  await page.getByRole('button', { name: '关闭设置' }).click();
  await expect(page.getByLabel('文明历史排行', { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-v04-panels.png` });
  await page.getByRole('button', { name: '切换设置面板' }).click();
  await page.getByRole('spinbutton', { name: '模拟速度 数值', exact: true }).fill('100');
  await page.getByLabel('自动重启', { exact: true }).uncheck();
  await page.getByLabel('暂停模拟', { exact: true }).uncheck();
  await expect.poll(async () => (await snapshot()).years).toBeGreaterThan(1);
  let s = await snapshot();
  expect(s.environment!.physicalYear).toBeCloseTo(s.years, 12);
  expect(s.environment!.reading.celsius).not.toBeNaN();
  expect(s.environment!.reading.flux).toBeGreaterThan(0);
  await page.getByLabel('暂停模拟', { exact: true }).check();
  await page.getByRole('button', { name: '重新运行当前 Seed' }).click();
  await expect.poll(async () => (await snapshot()).time).toBe(0);
  s = await snapshot();
  expect(s.bodies).toEqual(initial);
  expect(s.environment!.records).toHaveLength(0);
  expect(s.environment!.civilYear).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: '切换设置面板' }).click();
  await page.getByText('原版初始条件', { exact: true }).click();
  await expect(pos).toHaveValue('2.500');
  expect(errors).toEqual([]);
});
