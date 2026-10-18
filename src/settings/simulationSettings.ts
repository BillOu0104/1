import type { SimulationControls } from '../simulation/SimulationEngine';
import type { AppSettings } from './types';
import type { SeedMode } from '../simulation/seeds';

export function controlsFromSettings(
  settings: AppSettings,
  seedMode: SeedMode = settings.seedMode,
): SimulationControls {
  return {
    paused: settings.paused,
    speed: settings.speed,
    autoRestart: settings.autoRestart,
    maxRestarts: seedMode === 'random' || settings.unlimitedRestarts ? null : settings.maxRestarts,
  };
}
