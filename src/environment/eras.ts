import { ORIGINAL_LENGTH_AU } from '../physics/originalInitializer';
import type { V04Settings } from './config';
import type { EnvironmentReading } from './temperature';
export type EraKind =
  | 'stable'
  | 'chaotic'
  | 'sun1'
  | 'sun2'
  | 'sun3'
  | 'flying1'
  | 'flying2'
  | 'flying3';
export interface EraRecord {
  kind: EraKind;
  startYear: number;
  endYear: number;
  durationYears: number;
}
export function astronomicalCounts(
  r: EnvironmentReading,
  c: V04Settings,
): { overhead: number; flying: number } {
  return {
    overhead: r.distancesAU.filter((d) => d < c.overheadDistance * ORIGINAL_LENGTH_AU).length,
    flying:
      r.celsius < c.flyingTemperature
        ? r.distancesAU.filter((d) => d > c.flyingDistance * ORIGINAL_LENGTH_AU).length
        : 0,
  };
}
export function classifyEra(r: EnvironmentReading, c: V04Settings): EraKind {
  const a = astronomicalCounts(r, c);
  return a.overhead
    ? (`sun${a.overhead}` as EraKind)
    : a.flying
      ? (`flying${a.flying}` as EraKind)
      : r.celsius >= c.stableLow && r.celsius <= c.stableHigh
        ? 'stable'
        : 'chaotic';
}
export class EraMachine {
  kind: EraKind;
  startYear = 0;
  raw: EraKind;
  private candidate: EraKind;
  private candidateSince = 0;
  constructor(initial: EraKind) {
    this.kind = this.raw = this.candidate = initial;
  }
  observe(raw: EraKind, year: number, confirmation: number): EraRecord | null {
    this.raw = raw;
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.candidateSince = year;
    }
    const special = raw !== 'stable' && raw !== 'chaotic';
    if (raw === this.kind || (!special && year - this.candidateSince + 1e-12 < confirmation))
      return null;
    const old = {
      kind: this.kind,
      startYear: this.startYear,
      endYear: year,
      durationYears: year - this.startYear,
    };
    this.kind = raw;
    this.startYear = year;
    return old;
  }
}
