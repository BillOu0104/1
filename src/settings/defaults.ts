import type { AppSettings } from './types';
export interface DefaultsProvider<T> {
  getDefaults(): T;
}
export const settingsDefaults: DefaultsProvider<AppSettings> = {
  getDefaults: () => ({
    paused: false,
    speed: 1,
    seed: 'TRISOLARIS-001',
    autoRestart: true,
    trails: true,
  }),
};
