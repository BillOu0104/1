import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url))),
  baseline = mkdtempSync(join(tmpdir(), 'threebody-v01-'));
const vite = join(root, 'node_modules/vite/bin/vite.js'),
  servers = [];
const baselineCommit =
  process.env.BROWSER_BASELINE_COMMIT ?? '83acfeb12d3405855226e29040ca2ce4994ada16';
const baselineLabel = process.env.BROWSER_BASELINE_LABEL ?? 'v01';
const candidateLabel = process.env.BROWSER_CANDIDATE_LABEL ?? 'current';
async function waitFor(url) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Preview failed: ${url}`);
}
try {
  const archive = join(baseline, 'source.tar');
  execFileSync('git', ['archive', '--output', archive, baselineCommit], { cwd: root });
  execFileSync('tar', ['-xf', archive, '-C', baseline]);
  rmSync(archive);
  symlinkSync(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir');
  execFileSync(process.execPath, [vite, 'build'], {
    cwd: baseline,
    env: { ...process.env, VITE_BASE_PATH: './' },
    stdio: 'pipe',
  });
  execFileSync(process.execPath, [vite, 'build'], {
    cwd: root,
    env: { ...process.env, VITE_BASE_PATH: '/1/' },
    stdio: 'pipe',
  });
  for (const [cwd, port, base] of [
    [baseline, 4181, './'],
    [root, 4182, '/1/'],
  ]) {
    const child = spawn(
      process.execPath,
      [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd, env: { ...process.env, VITE_BASE_PATH: base }, stdio: 'ignore' },
    );
    servers.push(child);
  }
  await Promise.all([waitFor('http://127.0.0.1:4181/'), waitFor('http://127.0.0.1:4182/1/')]);
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const rows = [];
  try {
    for (let repetition = 0; repetition < 3; repetition++)
      for (const version of repetition % 2
        ? [candidateLabel, baselineLabel]
        : [baselineLabel, candidateLabel])
        for (const speed of [1, 20]) {
          const context = await browser.newContext({ viewport: { width: 2520, height: 1080 } }),
            page = await context.newPage();
          const errors = [];
          page.on('pageerror', (e) => errors.push(e.message));
          await page.addInitScript(
            ({ speed }) => {
              localStorage.setItem(
                'three-body:settings:v1',
                JSON.stringify({
                  version: 1,
                  settings: {
                    paused: false,
                    speed,
                    autoRestart: true,
                    trails: true,
                    seed: 'browser-benchmark',
                  },
                }),
              );
              const metrics = {
                workerCount: 0,
                workerCpu: [],
                screenCpu: [],
                messages: 0,
                frames: [],
                longTasks: [],
                active: false,
              };
              window.__threeBodyBenchmark = metrics;
              const NativeWorker = window.Worker;
              window.Worker = class extends NativeWorker {
                constructor(url, options) {
                  super(url, options);
                  metrics.workerCount++;
                  this.addEventListener('message', (event) => {
                    if (event.data.type === 'snapshot') {
                      metrics.messages++;
                      if (metrics.active) metrics.workerCpu.push(event.data.workerCpuMs);
                      if (event.data.snapshot.screening && metrics.screenCpu.length === 0)
                        metrics.screenCpu.push(event.data.snapshot.screening.cpuMs);
                    }
                  });
                }
              };
              new PerformanceObserver((list) => {
                if (metrics.active)
                  for (const entry of list.getEntries()) metrics.longTasks.push(entry.duration);
              }).observe({ type: 'longtask', buffered: false });
            },
            { speed },
          );
          await page.goto(
            version === baselineLabel ? 'http://127.0.0.1:4181/' : 'http://127.0.0.1:4182/1/',
          );
          await page.waitForFunction(
            () => Number(document.querySelector('.clock-meta strong')?.textContent) > 0,
            {},
            { timeout: 20000 },
          );
          await page.waitForTimeout(1500);
          const cdp = await context.newCDPSession(page);
          await cdp.send('Performance.enable');
          const before = await cdp.send('Performance.getMetrics');
          const sampleStart = performance.now();
          await page.evaluate(() => {
            const m = window.__threeBodyBenchmark;
            m.active = true;
            let previous = performance.now();
            const tick = (now) => {
              if (!m.active) return;
              m.frames.push(now - previous);
              previous = now;
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          await page.waitForTimeout(6000);
          const metrics = await page.evaluate(() => {
            window.__threeBodyBenchmark.active = false;
            return window.__threeBodyBenchmark;
          });
          const after = await cdp.send('Performance.getMetrics');
          const metric = (values, name) => values.metrics.find((m) => m.name === name)?.value ?? 0;
          const percentile = (values, p) =>
            [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)] ?? 0;
          const row = {
            version,
            repetition,
            speed,
            viewport: '2520x1080',
            sampleMs: performance.now() - sampleStart,
            rafP50Ms: percentile(metrics.frames, 0.5),
            rafP95Ms: percentile(metrics.frames, 0.95),
            frames: metrics.frames.length,
            mainTaskMs: (metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000,
            longTasks: metrics.longTasks.length,
            maxLongTaskMs: Math.max(0, ...metrics.longTasks),
            workerCount: metrics.workerCount,
            workerCpuP95Ms: percentile(metrics.workerCpu, 0.95),
            workerCpuSumMs: metrics.workerCpu.reduce((s, n) => s + n, 0),
            firstScreenCpuMs: metrics.screenCpu[0] ?? 0,
            jsHeapBytes: metric(after, 'JSHeapUsedSize'),
            errors,
          };
          rows.push(row);
          if (errors.length) throw new Error(`Browser benchmark errors: ${errors.join(', ')}`);
          console.log(row);
          await context.close();
        }
  } finally {
    await browser.close();
  }
  mkdirSync(join(root, 'docs/benchmarks'), { recursive: true });
  writeFileSync(
    join(root, process.env.BROWSER_OUTPUT ?? 'test-results/browser-current.json'),
    JSON.stringify(
      {
        baselineCommit,
        browser: process.env.CHROMIUM_PATH ?? chromium.executablePath(),
        browserVersion: browser.version(),
        renderer: 'SwiftShader software WebGL',
        node: process.version,
        rows,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  for (const child of servers) child.kill();
  rmSync(baseline, { recursive: true, force: true });
}
