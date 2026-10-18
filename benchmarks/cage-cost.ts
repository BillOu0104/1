import { writeFileSync } from 'node:fs';
import { derivative, pack } from '../src/physics/velocityVerlet';
import { RandomInitializer } from '../src/physics/initialConditions';
import { DEFAULT_PHYSICS } from '../src/physics/types';
import { DEFAULT_CAGE } from '../src/physics/cage';
const fixtures = Array.from({ length: 12 }, (_, i) => {
  const bodies = new RandomInitializer().generate(`kernel-v03-${i}`, {
    ...DEFAULT_PHYSICS,
    galaxyScale: 3,
  });
  const state = new Float64Array(28);
  pack(bodies, state);
  return { bodies, state };
});
const configs = [false, true].map((enabled) => ({
  ...DEFAULT_PHYSICS,
  galaxyScale: 3,
  cage: { ...DEFAULT_CAGE, enabled },
}));
const outputs = [new Float64Array(24), new Float64Array(28)],
  count = 300000;
function measure(mode: number, iterations: number) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const f = fixtures[i % fixtures.length]!;
    derivative(f.state, outputs[mode]!, f.bodies, configs[mode]!);
  }
  return performance.now() - start;
}
measure(0, 20000);
measure(1, 20000);
const samples: { newtonMs: number; cageMs: number }[] = [];
for (let i = 0; i < 5; i++) {
  const first = measure(i % 2, count),
    second = measure(1 - (i % 2), count);
  samples.push({ newtonMs: i % 2 ? second : first, cageMs: i % 2 ? first : second });
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[2]!;
const result = {
  method:
    'Five alternating warmed runs of 300000 force evaluations over twelve identical frozen four-body states at 3x. Includes stage COM, cage work and impulse derivatives. Excludes DOPRI assembly/error estimates, scheduling, UI and rendering.',
  count,
  samples,
  medianNanosecondsPerEvaluation: {
    newton: (median(samples.map((s) => s.newtonMs)) * 1e6) / count,
    cage: (median(samples.map((s) => s.cageMs)) * 1e6) / count,
  },
};
writeFileSync('docs/benchmarks/v03-cage-cost.json', JSON.stringify(result, null, 2) + '\n');
console.log(result);
