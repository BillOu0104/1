import { settingsDefaults, type DefaultsProvider } from './defaults';
import { settingsRegistry, type SettingsRegistry } from './registry';
import type { SettingsPersistence } from './persistence';
import type { AppSettings } from './types';
import { validNumeric } from './numeric';
export class SettingsStore {
  private state: AppSettings;
  private listeners = new Set<() => void>();
  persistenceAvailable = true;
  constructor(
    private readonly persistence?: SettingsPersistence,
    defaults: DefaultsProvider<AppSettings> = settingsDefaults,
    readonly registry: SettingsRegistry = settingsRegistry,
  ) {
    this.state = defaults.getDefaults();
    const saved = persistence?.load();
    if (
      saved &&
      typeof saved === 'object' &&
      'version' in saved &&
      saved.version === 1 &&
      'settings' in saved &&
      saved.settings &&
      typeof saved.settings === 'object'
    ) {
      for (const definition of registry.getDefinitions()) {
        const value = (saved.settings as Record<string, unknown>)[definition.key];
        if (this.valid(definition.key, value))
          this.state = { ...this.state, [definition.key]: value };
      }
    }
  }
  getSnapshot = (): AppSettings => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    if (!this.valid(key, value)) throw new Error(`Invalid setting ${key}`);
    this.state = { ...this.state, [key]: value };
    if (this.persistence)
      this.persistenceAvailable = this.persistence.save({ version: 1, settings: this.state });
    this.listeners.forEach((listener) => listener());
  }
  private valid(key: keyof AppSettings, value: unknown): boolean {
    const d = this.registry.get(key);
    return (
      !!d &&
      d.validate(value) &&
      (d.kind !== 'number' || validNumeric(value, d.min!, d.max!, d.step!))
    );
  }
}
