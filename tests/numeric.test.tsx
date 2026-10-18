// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { NumericSetting } from '../src/ui/components/NumericSetting';
import { SettingsStore } from '../src/settings/SettingsStore';
import { settingsRegistry } from '../src/settings/registry';
import type { NumericSettingKey } from '../src/settings/types';
afterEach(cleanup);

it('synchronizes every registered numeric control, respects step/range, rejects invalid drafts and persists', () => {
  let saved: unknown;
  const persistence = {
    load: () => saved,
    save: (value: unknown) => {
      saved = value;
      return true;
    },
  };
  const store = new SettingsStore(persistence);
  function Controls() {
    const settings = useSyncExternalStore(store.subscribe, store.getSnapshot);
    return (
      <>
        {settingsRegistry
          .getDefinitions()
          .filter((d) => d.kind === 'number')
          .map((d) => (
            <NumericSetting
              key={d.key}
              id={d.key}
              label={d.label}
              value={settings[d.key as NumericSettingKey]}
              min={d.min!}
              max={d.max!}
              step={d.step!}
              onChange={(v) => store.set(d.key as NumericSettingKey, v)}
            />
          ))}
      </>
    );
  }
  render(<Controls />);
  for (const d of settingsRegistry.getDefinitions().filter((d) => d.kind === 'number')) {
    const key = d.key as NumericSettingKey;
    const slider = screen.getByRole('slider', { name: d.label });
    const input = screen.getByRole('spinbutton', { name: `${d.label} 数值` });
    const value = Number((d.min! + d.step! * 2).toFixed(3));
    fireEvent.change(input, { target: { value: String(value) } });
    expect(store.getSnapshot()[key]).toBe(value);
    expect(slider).toHaveValue(String(value));
    fireEvent.change(slider, { target: { value: String(d.min!) } });
    expect(input).toHaveValue(d.min!);
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(store.getSnapshot()[key]).toBe(d.min!);
    fireEvent.blur(input);
    expect(input).toHaveValue(d.min!);
    expect(() => store.set(key, NaN)).toThrow();
    expect(() => store.set(key, Infinity)).toThrow();
    expect(() => store.set(key, d.min! - d.step!)).toThrow();
    expect(() => store.set(key, d.min! + d.step! / 2)).toThrow();
    expect(new SettingsStore(persistence).getSnapshot()[key]).toBe(d.min!);
  }
});

it('persists modes/limits/100× and ignores fractional or corrupt saved numbers', () => {
  const store = new SettingsStore();
  expect(store.getSnapshot().seedMode).toBe('random');
  const restored = new SettingsStore({
    load: () => ({
      version: 1,
      settings: {
        seedMode: 'fixed',
        seed: 'race',
        unlimitedRestarts: false,
        maxRestarts: 1,
        speed: 100,
        massA: 1.123,
        galaxyScale: 2.5,
      },
    }),
    save: () => true,
  });
  expect(restored.getSnapshot()).toMatchObject({
    seedMode: 'fixed',
    seed: 'race',
    unlimitedRestarts: false,
    maxRestarts: 1,
    speed: 100,
    massA: 1,
    galaxyScale: 3,
  });
});
