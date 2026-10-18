import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve('.'),
  baseline = mkdtempSync(join(tmpdir(), 'threebody-v021-'));
try {
  const archive = join(baseline, 'source.tar');
  execFileSync('git', ['archive', '--output', archive, '762ae5024c8369a8ffca3c187b602ee3ff7d5827']);
  execFileSync('tar', ['-xf', archive, '-C', baseline]);
  rmSync(archive);
  symlinkSync(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir');
  execFileSync(
    process.execPath,
    [join(root, 'node_modules/vite-node/vite-node.mjs'), 'benchmarks/lifetime.ts'],
    { env: { ...process.env, V021_ROOT: baseline }, stdio: 'inherit' },
  );
} finally {
  rmSync(baseline, { recursive: true, force: true });
}
