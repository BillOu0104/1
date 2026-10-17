import { describe, expect, it, vi } from 'vitest';
import { SettingsStore } from '../src/settings/SettingsStore';
import { LocalSettingsPersistence } from '../src/settings/persistence';
import { FeatureRegistry } from '../src/features/FeatureRegistry';
import { EventBus, type AppEvents } from '../src/events/EventBus';
describe('settings state and persistence', () => {
  it('validates writes, notifies subscribers, reloads known persisted values', () => {
    let saved = '';
    const persistence = new LocalSettingsPersistence({
      getItem: () => saved,
      setItem: (_key, value) => {
        saved = value;
      },
    });
    const store = new SettingsStore(persistence),
      listener = vi.fn(),
      unsubscribe = store.subscribe(listener);
    store.set('speed', 4);
    store.set('autoRestart', false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(new SettingsStore(persistence).getSnapshot()).toMatchObject({
      speed: 4,
      autoRestart: false,
    });
    expect(() => store.set('speed', Infinity)).toThrow();
    expect(() => store.set('seed', ' ')).toThrow();
    unsubscribe();
    store.set('trails', false);
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it('ignores corrupt, unsupported, and invalid persisted settings', () => {
    expect(
      new SettingsStore(
        new LocalSettingsPersistence({ getItem: () => '{bad', setItem: () => {} }),
      ).getSnapshot().speed,
    ).toBe(1);
    expect(
      new SettingsStore({
        load: () => ({
          version: 1,
          settings: { speed: -1, autoRestart: 'false', trails: false, unknown: 123 },
        }),
        save: () => true,
      }).getSnapshot(),
    ).toMatchObject({ speed: 1, autoRestart: true, trails: false });
    expect(
      new SettingsStore({
        load: () => ({ version: 999, settings: { speed: 5 } }),
        save: () => true,
      }).getSnapshot().speed,
    ).toBe(1);
  });
  it('keeps changes in memory when storage is unavailable', () => {
    const store = new SettingsStore(
      new LocalSettingsPersistence({
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('full');
        },
      }),
    );
    expect(() => store.set('speed', 2)).not.toThrow();
    expect(store.getSnapshot().speed).toBe(2);
    expect(store.persistenceAvailable).toBe(false);
  });
});
describe('feature and event extension contracts', () => {
  it('registers, enables once, cleans up, and refuses planned features', () => {
    const registry = new FeatureRegistry(),
      activate = vi.fn(() => cleanup),
      cleanup = vi.fn();
    registry.register({
      id: 'audio',
      label: 'audio',
      description: 'test',
      status: 'partial',
      activate,
    });
    registry.register({ id: 'dust', label: 'dust', description: 'test', status: 'planned' });
    const context = { settings: new SettingsStore(), events: new EventBus<AppEvents>() };
    registry.enable('audio', context);
    registry.enable('audio', context);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(() => registry.enable('dust', context)).toThrow();
    registry.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('unsubscribes typed event listeners', () => {
    const bus = new EventBus<AppEvents>(),
      listener = vi.fn(),
      off = bus.on('visibility', listener);
    bus.emit('visibility', false);
    off();
    bus.emit('visibility', true);
    expect(listener).toHaveBeenCalledExactlyOnceWith(false);
  });
});
