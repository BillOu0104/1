import { DEFAULT_CAGE, type GravityCageConfig } from '../physics/cage';
import type { AppSettings } from './types';
export const CAGE_SETTINGS = {
  cageMass: 'mass',
  cageK1: 'k1',
  cageRe: 're',
  cageK2: 'k2',
  cageRc: 'rc',
  cageExponent: 'exponent',
  cageHardRadius: 'hardRadius',
} as const;
export function cageFromSettings(s: AppSettings): GravityCageConfig {
  return {
    ...DEFAULT_CAGE,
    enabled: s.cageEnabled,
    hard: s.cageHard,
    mass: s.cageMass,
    k1: s.cageK1,
    re: s.cageRe,
    k2: s.cageK2,
    rc: s.cageRc,
    exponent: s.cageExponent,
    hardRadius: s.cageHardRadius,
  };
}
