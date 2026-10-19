import { V04_RULES } from '../environment/config';
import { CAGE_PARAMETER_RULES } from '../physics/cage';
import { CAGE_SETTINGS } from './physicsSettings';
import { MAX_TRAIL_YEARS } from '../physics/trajectory';
import type { AppSettings } from './types';
import type { SeedMode } from '../simulation/seeds';
export type SettingDefinition = {
  [K in keyof AppSettings]: {
    key: K;
    label: string;
    category: string;
    kind: 'boolean' | 'number' | 'seed' | 'seed-mode';
    min?: number;
    max?: number;
    step?: number;
    description?: string;
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
    max: 100,
    step: 0.1,
    validate: (v): v is number =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0.1 && v <= 100,
  })
  .register({
    key: 'autoRestart',
    label: '自动重启',
    category: '运行控制',
    kind: 'boolean',
    validate: (v): v is boolean => typeof v === 'boolean',
  })
  .register({
    key: 'galaxyScale',
    label: '星系尺度 Galaxy Scale',
    category: '初始条件',
    kind: 'number',
    min: 1,
    max: 10,
    step: 1,
    validate: (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 10,
  })
  .register({
    key: 'seedMode',
    label: 'Seed 模式',
    category: '初始条件',
    kind: 'seed-mode',
    validate: (v): v is SeedMode => v === 'random' || v === 'fixed',
  })
  .register({
    key: 'unlimitedRestarts',
    label: '自动重置次数不限制',
    category: '初始条件',
    kind: 'boolean',
    validate: (v): v is boolean => typeof v === 'boolean',
  })
  .register({
    key: 'maxRestarts',
    label: '最大自动重置次数 Max Restarts',
    category: '初始条件',
    kind: 'number',
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    step: 1,
    validate: (v): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
  })
  .register({
    key: 'seed',
    label: '随机种子 Seed',
    category: '初始条件',
    kind: 'seed',
    validate: (v): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 80,
  })
  .register({
    key: 'trailLengthYears',
    label: '尾迹长度 Trail Length',
    category: '轨道外观',
    kind: 'number',
    min: 0.1,
    max: MAX_TRAIL_YEARS,
    step: 0.1,
    validate: (v): v is number =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0.1 && v <= MAX_TRAIL_YEARS,
  })
  .register({
    key: 'trails',
    label: '显示轨迹',
    category: '轨道外观',
    kind: 'boolean',
    validate: (v): v is boolean => typeof v === 'boolean',
  });

for (const [key, name] of [
  ['massA', 'A'],
  ['massB', 'B'],
  ['massC', 'C'],
] as const) {
  settingsRegistry.register({
    key,
    label: `恒星 ${name} 参考质量 M☉`,
    category: '天体参数',
    kind: 'number',
    min: 0.08,
    max: 3,
    step: 0.01,
    validate: (v): v is number =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0.08 && v <= 3,
  });
}

for (const [key, label] of [
  ['cageEnabled', '引力牢笼总开关'],
  ['cageHard', '硬牢笼开关'],
] as const)
  settingsRegistry.register({
    key,
    label,
    category: '引力牢笼',
    kind: 'boolean',
    validate: (v): v is boolean => typeof v === 'boolean',
  });
const cageLabels = {
  cageMass: 'Mc 约束等效质量',
  cageK1: 'k1 内区斥力强度',
  cageRe: 're 内区斥力半径',
  cageK2: 'k2 外区约束强度',
  cageRc: 'rc 外区约束距离',
  cageExponent: 'expc 软约束指数',
  cageHardRadius: 'Rc 硬牢笼约束半径',
};
for (const key of Object.keys(CAGE_SETTINGS) as (keyof typeof CAGE_SETTINGS)[]) {
  const rule = CAGE_PARAMETER_RULES[CAGE_SETTINGS[key]];
  settingsRegistry.register({
    key,
    label: cageLabels[key],
    category: '引力牢笼',
    kind: 'number',
    min: rule.min,
    max: rule.max,
    step: rule.step,
    validate: (v): v is number =>
      typeof v === 'number' && Number.isFinite(v) && v >= rule.min && v <= rule.max,
  });
}

for (const [key, rule] of Object.entries(V04_RULES)) {
  const numeric = 'min' in rule;
  settingsRegistry.register({
    key,
    label: rule.label,
    category: rule.category,
    kind: numeric ? 'number' : 'boolean',
    ...('min' in rule ? { min: rule.min, max: rule.max, step: rule.step } : {}),
    description: rule.description,
    validate: (v: unknown) =>
      numeric
        ? typeof v === 'number' &&
          Number.isFinite(v) &&
          'min' in rule &&
          v >= rule.min &&
          v <= rule.max
        : typeof v === 'boolean',
  } as SettingDefinition);
}
