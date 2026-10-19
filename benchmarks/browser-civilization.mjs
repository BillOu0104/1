import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = process.cwd(),
  old = mkdtempSync(join(tmpdir(), 'threebody-v04-browser-')),
  servers = [];
const baseline = 'edca79d20c027e7601e4b1d7f6f5ad59fc6bada4';
const vite = join(root, 'node_modules/vite/bin/vite.js');
let browser;
try {
  execFileSync('git', ['archive', '--output', join(old, 'source.tar'), baseline]);
  execFileSync('tar', ['-xf', join(old, 'source.tar'), '-C', old]);
  symlinkSync(join(root, 'node_modules'), join(old, 'node_modules'), 'dir');
  execFileSync(process.execPath, [vite, 'build'], { cwd: old, stdio: 'pipe' });
  for (const [cwd, port] of [
    [old, 4191],
    [root, 4192],
  ]) {
    servers.push(
      spawn(
        process.execPath,
        [vite, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
        { cwd, stdio: 'ignore' },
      ),
    );
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/`)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!ready) throw new Error('Preview failed');
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const rows = [];
  for (let repetition = 0; repetition < 2; repetition++)
    for (const [version, port] of repetition % 2
      ? [
          ['v04', 4192],
          ['v031', 4191],
        ]
      : [
          ['v031', 4191],
          ['v04', 4192],
        ])
      for (const speed of [1, 100]) {
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
                settings: { seedMode: 'fixed', seed: 'v04-browser-cost', speed, autoRestart: true },
              }),
            );
            const m = {
              active: false,
              workers: 0,
              pending: 0,
              maxPending: 0,
              cpu: [],
              longTasks: [],
              frames: [],
              maxEvents: 0,
              maxRecords: 0,
              maxRanks: 0,
              years: 0,
            };
            window.__civilMetrics = m;
            const Native = window.Worker;
            window.Worker = class extends Native {
              constructor(url, options) {
                super(url, options);
                m.workers++;
                this.addEventListener('message', (e) => {
                  if (e.data.type === 'snapshot') {
                    if (e.data.sequence !== undefined) m.pending--;
                    const s = e.data.snapshot;
                    if (m.active) m.cpu.push(e.data.workerCpuMs);
                    m.years = s.years;
                    m.maxEvents = Math.max(m.maxEvents, s.environment?.events.length ?? 0);
                    m.maxRecords = Math.max(m.maxRecords, s.environment?.records.length ?? 0);
                    m.maxRanks = Math.max(m.maxRanks, s.environment?.sessionRanking.length ?? 0);
                  }
                });
              }
              postMessage(message, ...rest) {
                if (message.type === 'tick') {
                  m.pending++;
                  m.maxPending = Math.max(m.maxPending, m.pending);
                }
                super.postMessage(message, ...rest);
              }
            };
            new PerformanceObserver((l) => {
              if (m.active) for (const e of l.getEntries()) m.longTasks.push(e.duration);
            }).observe({ type: 'longtask' });
          },
          { speed },
        );
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.waitForFunction(
          () => Number(document.querySelector('.clock-meta strong')?.textContent) > 0,
        );
        await page.waitForTimeout(1000);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Performance.enable');
        const before = await cdp.send('Performance.getMetrics');
        await page.evaluate(() => {
          const m = window.__civilMetrics;
          m.active = true;
          let last = performance.now();
          const frame = (n) => {
            if (!m.active) return;
            m.frames.push(n - last);
            last = n;
            requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        });
        await page.waitForTimeout(5000);
        const m = await page.evaluate(() => {
          window.__civilMetrics.active = false;
          return window.__civilMetrics;
        });
        const after = await cdp.send('Performance.getMetrics');
        const metric = (s, n) => s.metrics.find((m) => m.name === n)?.value ?? 0;
        const p95 = (a) => [...a].sort((a, b) => a - b)[Math.floor((a.length - 1) * 0.95)] ?? 0;
        rows.push({
          version,
          repetition,
          speed,
          observedYears: m.years,
          workers: m.workers,
          maxPending: m.maxPending,
          workerCpuMs: m.cpu.reduce((a, b) => a + b, 0),
          workerCpuP95Ms: p95(m.cpu),
          rafP95Ms: p95(m.frames),
          longTasks: m.longTasks.length,
          maxLongTaskMs: Math.max(0, ...m.longTasks),
          mainTaskMs: (metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000,
          mainHeapBefore: metric(before, 'JSHeapUsedSize'),
          mainHeapAfter: metric(after, 'JSHeapUsedSize'),
          maxEvents: m.maxEvents,
          maxRecords: m.maxRecords,
          maxSessionRanking: m.maxRanks,
          errors,
        });
        if (
          errors.length ||
          m.maxPending > 1 ||
          m.workers !== 1 ||
          m.maxEvents > 512 ||
          m.maxRecords > 256 ||
          m.maxRanks > 6
        )
          throw new Error('Browser reliability check failed');
        await context.close();
        console.log(rows.at(-1));
      }
  mkdirSync(resolve('docs/benchmarks'), { recursive: true });
  writeFileSync(
    'docs/benchmarks/browser-v04.json',
    JSON.stringify(
      {
        baseline,
        browser: browser.version(),
        renderer: 'SwiftShader software WebGL',
        method:
          '21:9, fixed Seed, 2 alternating repetitions × 1/100×, 5s active samples after warmup. Main heap includes uncollected garbage; not a Worker heap leak measurement.',
        rows,
      },
      null,
      2,
    ) + '\n',
  );
} finally {
  await browser?.close();
  for (const s of servers) s.kill();
  rmSync(old, { recursive: true, force: true });
}
