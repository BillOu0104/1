import type { AppSettings } from './types';
export interface DefaultsProvider<T> {
  getDefaults(): T;
}
export const settingsDefaults: DefaultsProvider<AppSettings> = {
  getDefaults: () => ({
    massA: 1,
    massB: 0.95,
    massC: 0.9,
    paused: false,
    speed: 1,
    seed: 'TRISOLARIS-001',
    autoRestart: true,
    trails: true,
  }),
};
