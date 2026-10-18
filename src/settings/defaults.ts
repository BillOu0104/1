import { DEFAULT_CAGE } from '../physics/cage';
import type { AppSettings } from './types';
export interface DefaultsProvider<T> {
  getDefaults(): T;
}
export const settingsDefaults: DefaultsProvider<AppSettings> = {
  getDefaults: () => ({
    galaxyScale: 3,
    cageEnabled: DEFAULT_CAGE.enabled,
    cageHard: DEFAULT_CAGE.hard,
    cageMass: DEFAULT_CAGE.mass,
    cageK1: DEFAULT_CAGE.k1,
    cageRe: DEFAULT_CAGE.re,
    cageK2: DEFAULT_CAGE.k2,
    cageRc: DEFAULT_CAGE.rc,
    cageExponent: DEFAULT_CAGE.exponent,
    cageHardRadius: DEFAULT_CAGE.hardRadius,
    massA: 1,
    massB: 0.95,
    massC: 0.9,
    paused: false,
    speed: 1,
    seed: 'TRISOLARIS-001',
    seedMode: 'random',
    unlimitedRestarts: true,
    maxRestarts: 0,
    autoRestart: true,
    trails: true,
    trailLengthYears: 2,
  }),
};
