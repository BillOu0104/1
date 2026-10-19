import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve('.');
const baseline = mkdtempSync(join(tmpdir(), 'threebody-planet-baseline-'));
try {
  const archive = join(baseline, 'source.tar');
  execFileSync('git', ['archive', '--output', archive, 'cfc2c2e0fce9d45bf9250c727f076dda3b221b41']);
  execFileSync('tar', ['-xf', archive, '-C', baseline]);
  rmSync(archive);
  symlinkSync(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir');
  execFileSync(
    process.execPath,
    [join(root, 'node_modules/vite-node/vite-node.mjs'), 'benchmarks/planet-overlap.ts'],
    { env: { ...process.env, PLANET_BASELINE_ROOT: baseline }, stdio: 'inherit' },
  );
} finally {
  rmSync(baseline, { recursive: true, force: true });
}
