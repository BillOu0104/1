import { expect, test } from '@playwright/test';
test('renders live WebGL, responds to controls, stays within viewport and retains one canvas across resets', async ({
  page,
  baseURL,
}, testInfo) => {
  const errors: string[] = [];
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  const assetErrors: string[] = [];
  const assetTypes = new Set<string>();
  const assetPath = `${new URL(baseURL!).pathname}assets/`;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    const type = response.request().resourceType();
    if (type !== 'script' && type !== 'stylesheet') return;
    assetTypes.add(type);
    if (!response.ok() || !new URL(response.url()).pathname.startsWith(assetPath)) {
      assetErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto('./');
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const time = page.locator('.clock-meta strong');
  await expect.poll(() => time.textContent()).not.toBe('0.000');
  await page.screenshot({ path: `test-results/${testInfo.project.name}-default.png` });
  await expect(page.getByLabel('行星与事件信息')).toBeHidden();
  await page.getByRole('button', { name: '切换左右信息面板' }).click();
  await expect(page.getByLabel('行星与事件信息')).toBeVisible();
  await expect(page.getByLabel('天体与物理统计')).toBeVisible();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-panels.png` });
  const bounds = await page.locator('.info-panel').evaluateAll((panels) =>
    panels.map((p) => {
      const r = p.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    }),
  );
  const viewport = page.viewportSize()!;
  for (const r of bounds) {
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(viewport.width);
    expect(r.bottom).toBeLessThanOrEqual(viewport.height);
  }
  expect(bounds[0]!.right).toBeLessThanOrEqual(bounds[1]!.x);
  await page.getByRole('button', { name: '切换设置面板' }).click();
  await page.getByLabel('暂停模拟', { exact: true }).check();
  const paused = await time.textContent();
  await page.waitForTimeout(300);
  expect(await time.textContent()).toBe(paused);
  await page.getByRole('slider', { name: '模拟速度', exact: true }).fill('3');
  await page.getByLabel('显示轨迹').uncheck();
  await page.getByLabel('自动重启').uncheck();
  await page.getByLabel('Seed 模式', { exact: true }).selectOption('fixed');
  await page.getByLabel('随机种子 Seed').fill('browser-seed');
  await page.getByRole('button', { name: '应用并重置' }).click();
  await expect(time).toHaveText('0.000');
  await expect(page.getByText('当前运行 Seed：')).toContainText('browser-seed');
  // Hold the DOM identity, so resetting cannot silently replace the WebGL renderer.
  await page.locator('canvas').evaluate((canvas) => canvas.setAttribute('data-original', 'yes'));
  await page.getByRole('button', { name: /手动重置/ }).click();
  await expect(page.locator('canvas[data-original="yes"]')).toHaveCount(1);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-settings.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('模拟设置', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '切换设置面板' }).click();
  await page.getByLabel('暂停模拟', { exact: true }).uncheck();
  await expect.poll(() => time.textContent()).not.toBe('0.000');
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewport.width / 2 + 70, viewport.height / 2 + 20);
  await page.mouse.up();
  await page.mouse.wheel(0, 150);
  await page.setViewportSize({ width: 960, height: 540 });
  await page.waitForTimeout(150);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(workers).toHaveLength(1);
  expect(new URL(workers[0]!).pathname).toContain(
    `${new URL(baseURL!).pathname}assets/physics.worker-`,
  );
  expect(assetErrors).toEqual([]);
  expect(assetTypes).toEqual(new Set(['script', 'stylesheet']));
});
test('offers a readable recovery message when WebGL is unavailable', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One failure-path check is sufficient');
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type.includes('webgl')) return null;
      return Reflect.apply(original, this, [type, ...args]) as ReturnType<typeof original>;
    } as typeof original;
  });
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('无法启动 WebGL');
  await expect(page.getByRole('button', { name: '重试渲染' })).toBeVisible();
  await context.close();
});
