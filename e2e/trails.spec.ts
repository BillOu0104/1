import { expect, test } from '@playwright/test';
interface Probe {
  workerCount: number;
  maxBatchPoints: number;
  generations: number[];
  firstTimes: number[];
  lineCounts: number[];
  screening: number;
}
const readProbe = () => (window as unknown as { __trailProbe: Probe }).__trailProbe;
test('draws Worker integration histories at 20× and changes the persisted time window while paused', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'three-body:settings:v1',
      JSON.stringify({
        version: 1,
        settings: {
          seed: 'fix-bench-1',
          speed: 20,
          autoRestart: false,
          trails: true,
          trailLengthYears: 2,
        },
      }),
    );
    const probe: Probe = {
      workerCount: 0,
      maxBatchPoints: 0,
      generations: [],
      firstTimes: [],
      lineCounts: [],
      screening: 0,
    };
    (window as unknown as { __trailProbe: Probe }).__trailProbe = probe;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        probe.workerCount++;
        this.addEventListener('message', (event: MessageEvent) => {
          const m = event.data;
          if (m.type === 'screening' || m.snapshot?.screening) probe.screening++;
          if (!m.trails) return;
          probe.maxBatchPoints = Math.max(probe.maxBatchPoints, m.trails.points.length / 5);
          if (probe.generations.at(-1) !== m.trails.generation) {
            probe.generations.push(m.trails.generation);
            probe.firstTimes.push(m.trails.points[1]);
          }
        });
      }
    };
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (mode, first, count) {
      if (mode === this.LINE_STRIP && count > 1) {
        probe.lineCounts.push(count);
        if (probe.lineCounts.length > 1000) probe.lineCounts.splice(0, 500);
      }
      draw.call(this, mode, first, count);
    };
  });
  await page.goto('./');
  await expect
    .poll(async () => Number(await page.locator('.clock-meta strong').textContent()))
    .toBeGreaterThan(2);
  await page.getByRole('button', { name: '切换设置面板' }).click();
  await page.getByLabel('暂停模拟', { exact: true }).check();
  await page.waitForTimeout(100);
  const paused = await page.locator('.clock-meta strong').textContent();
  const generation = (await page.evaluate(readProbe)).generations.at(-1);
  await page.evaluate(() => {
    (window as unknown as { __trailProbe: Probe }).__trailProbe.lineCounts = [];
  });
  await page.getByRole('slider', { name: /尾迹长度 Trail Length/ }).fill('0.1');
  await expect
    .poll(async () => (await page.evaluate(readProbe)).lineCounts.length)
    .toBeGreaterThan(0);
  const short = Math.max(...(await page.evaluate(readProbe)).lineCounts);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-trails-short.png` });
  await page.evaluate(() => {
    (window as unknown as { __trailProbe: Probe }).__trailProbe.lineCounts = [];
  });
  await page.getByRole('slider', { name: /尾迹长度 Trail Length/ }).fill('2');
  await expect
    .poll(async () => (await page.evaluate(readProbe)).lineCounts.length)
    .toBeGreaterThan(0);
  const long = Math.max(...(await page.evaluate(readProbe)).lineCounts);
  expect(long).toBeGreaterThan(short * 3);
  expect(long).toBeLessThanOrEqual(8192);
  expect(await page.locator('.clock-meta strong').textContent()).toBe(paused);
  expect((await page.evaluate(readProbe)).generations.at(-1)).toBe(generation);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('three-body:settings:v1')!).settings.trailLengthYears,
    ),
  ).toBe(2);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-trails-long.png` });
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /手动重置/ }).click();
    await expect.poll(async () => (await page.evaluate(readProbe)).generations.length).toBe(i + 2);
  }
  const p = await page.evaluate(readProbe);
  expect(p.workerCount).toBe(1);
  expect(p.screening).toBe(0);
  expect(p.maxBatchPoints).toBeGreaterThan(16);
  expect(p.firstTimes).toEqual([0, 0, 0, 0]);
});
