import { describe, expect, it } from 'vitest';
import { ScreeningJob, screenSynchronously } from '../src/physics/screening';
import { StructuredChaosInitializer, acceptableChaos } from '../src/physics/structuredChaos';
import { DEFAULT_PHYSICS } from '../src/physics/types';
import { DEFAULT_MASSES, EARTH_RADIUS } from '../src/physics/parameters';
import { centerOfMass, length } from '../src/physics/vector';
import { SimulationEngine } from '../src/simulation/SimulationEngine';
describe('Structured Chaos candidate screening', () => {
  it('removes drift, constrains angular momentum, and avoids initial hierarchical stars over 100 seeds', () => {
    const generator = new StructuredChaosInitializer();
    for (let i = 0; i < 100; i++) {
      const b = generator.generate(`chaos-${i}`, DEFAULT_PHYSICS);
      expect(acceptableChaos(b, DEFAULT_PHYSICS)).toBe(true);
      expect(length(centerOfMass(b))).toBeLessThan(1e-12);
      expect(length(centerOfMass(b, 'velocity'))).toBeLessThan(1e-12);
      expect(b[3]!.radius).toBe(EARTH_RADIUS);
    }
  });
  it('selects the same original initial condition across different slice budgets, starting at zero years', () => {
    const options = { candidates: 3, years: 2, maxStepsPerCandidate: 3000 };
    const a = screenSynchronously('deterministic', DEFAULT_MASSES, options),
      job = new ScreeningJob('deterministic', DEFAULT_MASSES, options);
    let batches = 0;
    while (!job.pump(0)) {
      if (++batches > 1000) throw new Error('Unbounded screening');
    }
    const b = job.getResult();
    expect(b.bodies).toEqual(a.bodies);
    expect(b.summary.selectedCandidate).toBe(a.summary.selectedCandidate);
    expect(b.bodies).toEqual(b.reports[b.summary.selectedCandidate]!.initial);
    const engine = new SimulationEngine('deterministic', { initialBodies: b.bodies });
    expect(engine.snapshot().years).toBe(0);
    expect(b.summary.qualified).toBeGreaterThan(0);
  });
  it('has a finite deterministic fallback without relabeling it as qualified', () => {
    const result = screenSynchronously('fallback', DEFAULT_MASSES, {
      candidates: 2,
      years: 5,
      maxStepsPerCandidate: 1,
      maxBatchesPerCandidate: 1,
    });
    expect(result.summary.fallback).toBe(true);
    expect(result.summary.qualified).toBe(0);
    expect(result.reports).toHaveLength(2);
    expect(result.summary.previewSteps).toBeLessThanOrEqual(64);
  });
});
