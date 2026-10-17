import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve('.');
const baseline = mkdtempSync(join(tmpdir(), 'threebody-v02-'));
try {
  const archive = join(baseline, 'source.tar');
  execFileSync('git', ['archive', '--output', archive, '39d830bdcbf13bc0c4c7e0e799115c42b6303265']);
  execFileSync('tar', ['-xf', archive, '-C', baseline]);
  rmSync(archive);
  symlinkSync(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir');
  execFileSync(
    process.execPath,
    [join(root, 'node_modules/vite-node/vite-node.mjs'), 'benchmarks/fixes.ts'],
    {
      env: { ...process.env, V02_ROOT: baseline },
      stdio: 'inherit',
    },
  );
} finally {
  rmSync(baseline, { recursive: true, force: true });
}
