import type { AppSettings } from './types';
export type SettingDefinition = {
  [K in keyof AppSettings]: {
    key: K;
    label: string;
    category: string;
    kind: 'boolean' | 'number' | 'seed';
    min?: number;
    max?: number;
    step?: number;
    validate: (value: unknown) => value is AppSettings[K];
  };
}[keyof AppSettings];
export class SettingsRegistry {
  private entries = new Map<keyof AppSettings, SettingDefinition>();
  register(definition: SettingDefinition): this {
    if (this.entries.has(definition.key)) throw new Error(`Duplicate setting: ${definition.key}`);
    this.entries.set(definition.key, definition);
    return this;
  }
  getDefinitions(): SettingDefinition[] {
    return [...this.entries.values()];
  }
  get(key: keyof AppSettings): SettingDefinition | undefined {
    return this.entries.get(key);
  }
}
export const settingsRegistry = new SettingsRegistry()
  .register({
    key: 'paused',
    label: '暂停模拟',
    category: '运行控制',
    kind: 'boolean',
    validate: (v): v is boolean => typeof v === 'boolean',
  })
  .register({
    key: 'speed',
    label: '模拟速度',
    category: '运行控制',
    kind: 'number',
    min: 0.1,
    max: 20,
    step: 0.1,
    validate: (v): v is number =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0.1 && v <= 20,
  })
  .register({
    key: 'autoRestart',
    label: '自动重启',
    category: '运行控制',
    kind: 'boolean',
    validate: (v): v is boolean => typeof v === 'boolean',
  })
  .register({
    key: 'seed',
    label: '随机种子 Seed',
    category: '初始条件',
    kind: 'seed',
    validate: (v): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 80,
  })
  .register({
    key: 'trails',
    label: '显示轨迹',
    category: '轨道外观',
    kind: 'boolean',
    validate: (v): v is boolean => typeof v === 'boolean',
  });
