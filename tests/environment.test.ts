import { SimulationEngine } from '../src/simulation/SimulationEngine';
import { DEFAULT_CAGE } from '../src/physics/cage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { V04_DEFAULTS, V04_RULES } from '../src/environment/config';
import {
  radiationTemperature,
  readEnvironment,
  type EnvironmentReading,
} from '../src/environment/temperature';
import * as temperature from '../src/environment/temperature';
import { classifyEra, astronomicalCounts, EraMachine } from '../src/environment/eras';
import {
  CIVIL_EVENT_LIMIT,
  CIVIL_HISTORY_LIMIT,
  CivilizationSimulation,
} from '../src/environment/CivilizationSimulation';
import { ORIGINAL_LENGTH_AU, OriginalRandomInitializer } from '../src/physics/originalInitializer';
import { DEFAULT_PHYSICS, UNITS_PER_YEAR } from '../src/physics/types';
import { SettingsStore } from '../src/settings/SettingsStore';
import { settingsRegistry } from '../src/settings/registry';
const bodies = () => new OriginalRandomInitializer().generate('test-environment', DEFAULT_PHYSICS);
const reading = (celsius = 20): EnvironmentReading => ({
  celsius,
  kelvin: celsius + 273.15,
  equilibriumKelvin: celsius + 273.15,
  flux: 1361,
  albedo: 0.3,
  distancesAU: [5, 5, 5],
  starDistancesAU: [5, 5, 5],
  model: 'radiative',
});
function fixture(extra: Partial<typeof V04_DEFAULTS> = {}) {
  let r = reading();
  vi.spyOn(temperature, 'readEnvironment').mockImplementation(() => ({ ...r }));
  const s = new CivilizationSimulation({ ...V04_DEFAULTS, ...extra }),
    b = bodies();
  s.reset(b, 1, 'civil-seed');
  return {
    s,
    b,
    set: (next: Partial<EnvironmentReading>) => {
      r = { ...r, ...next };
    },
    at: (year: number) => s.observe(b, year * UNITS_PER_YEAR),
  };
}
afterEach(() => vi.restoreAllMocks());
describe('temperature formulas from original sources', () => {
  it('calculates solar flux and ice feedback, K/C conversion and multi-star addition', () => {
    const a = radiationTemperature([1], [1], 1, 0),
      b = radiationTemperature([1, 1], [1, 1], 1, 0);
    // Original rounded AU constant introduces a documented 2.8e-5 relative factor.
    expect(a.flux).toBeCloseTo(1361, 0);
    expect(b.flux).toBeCloseTo(2 * a.flux, 9);
    expect(a.albedo).toBeCloseTo(
      0.3 + 0.3 * ((273.15 - ((a.flux * 0.7) / (4 * 5.67e-8)) ** 0.25) / 20),
      12,
    );
    expect(radiationTemperature([2], [1], 1, 0).albedo).toBe(0.6);
    expect(a.kelvin - a.celsius).toBeCloseTo(273.15, 10);
    expect(b.kelvin).toBeGreaterThan(a.kelvin);
  });
  it('obeys inverse square distances, independent luminosity and κ, includes clamp and deterministic phase', () => {
    const a = radiationTemperature([2], [1], 1, 0),
      b = radiationTemperature([4], [1], 1, 0),
      c = radiationTemperature([4], [1], 2, 0);
    expect(a.flux / b.flux).toBeCloseTo(4, 12);
    expect(c.flux).toBe(a.flux);
    expect(radiationTemperature([0], [10], 10, 0).celsius).toBe(1500);
    expect(radiationTemperature([1e15], [1], 1, 0).celsius).toBe(-270);
    expect(radiationTemperature([2], [1], 1, Math.PI / 2).celsius - a.celsius).toBeCloseTo(10, 2);
  });
  it('reproduces old Tx formula explicitly and galaxy scale reduces radiative flux', () => {
    const b = bodies(),
      c = { ...V04_DEFAULTS, legacyTemperature: true };
    const r = readEnvironment(b, 0, c);
    const q = Math.max(
      0.1,
      Math.min(
        2,
        r.distancesAU.reduce(
          (s, d, i) => s + [0.4, 0.3, 0.3][i]! / Math.sqrt(d / ORIGINAL_LENGTH_AU),
          0,
        ),
      ),
    );
    expect(r.celsius).toBe(1190 * (q / 1.9) ** 2 - 220);
    const a = readEnvironment(b, 0, V04_DEFAULTS),
      scaled = b.map((x) => ({
        ...x,
        position: x.position.map((v) => v * 3) as [number, number, number],
      }));
    expect(readEnvironment(scaled, 0, V04_DEFAULTS).flux / a.flux).toBeCloseTo(1 / 9, 12);
  });
});
describe('era and astronomical rules', () => {
  it.each([1, 2, 3])('classifies %i overhead/flying stars with original priority', (n) => {
    const r = {
      ...reading(-100),
      distancesAU: [0, 1, 2].map((i) => (i < n ? 0.2 : 3) * ORIGINAL_LENGTH_AU),
    };
    expect(classifyEra(r, V04_DEFAULTS)).toBe(`sun${n}`);
    r.distancesAU = [0, 1, 2].map((i) => (i < n ? 3 : 1) * ORIGINAL_LENGTH_AU);
    expect(classifyEra(r, V04_DEFAULTS)).toBe(`flying${n}`);
  });
  it('uses strict distance/flying temperature and inclusive stable temperature boundaries', () => {
    const r = { ...reading(-55), distancesAU: [0.3, 1, 2].map((x) => x * ORIGINAL_LENGTH_AU) };
    expect(classifyEra(r, V04_DEFAULTS)).toBe('stable');
    r.celsius = 70;
    expect(classifyEra(r, V04_DEFAULTS)).toBe('stable');
    r.celsius = 70.01;
    expect(classifyEra(r, V04_DEFAULTS)).toBe('chaotic');
    r.celsius = -70;
    r.distancesAU = [3, 3, 3].map((x) => x * ORIGINAL_LENGTH_AU);
    expect(astronomicalCounts(r, V04_DEFAULTS).flying).toBe(0);
  });
  it('confirms ordinary eras continuously, records duration and never delays special events', () => {
    const m = new EraMachine('stable');
    expect(m.observe('chaotic', 1, 0.1)).toBeNull();
    expect(m.observe('stable', 1.05, 0.1)).toBeNull();
    expect(m.observe('chaotic', 2, 0.1)).toBeNull();
    expect(m.observe('chaotic', 2.11, 0.1)?.durationYears).toBe(2.11);
    expect(m.observe('sun3', 2.12, 1)?.kind).toBe('chaotic');
  });
});
describe('complete civilization lifecycle', () => {
  it('requires ceil(n) suitable ticks, counts while alive and uses integer civilization lifetimes', () => {
    const { s, at, set } = fixture({ birthThreshold: 2.1 });
    at(2 / 60);
    expect(s.snapshot().alive).toBe(false);
    at(3 / 60);
    expect(s.snapshot().alive).toBe(true);
    at(2.1);
    set({ celsius: 201 });
    at(2.11);
    const r = s.snapshot().records[0]!;
    expect(r.number).toBe(1);
    expect(r.lifespan).toBe(2);
    expect(r.cause).toBe('hot');
    expect(s.snapshot().civilization).toBe(2);
  });
  it('supports dehydration/rehydration without stopping development, then rebirth in the same universe', () => {
    const { s, at, set } = fixture({ birthThreshold: 1 });
    at(0.02);
    set({ celsius: -60 });
    at(0.03);
    expect(s.snapshot().alive).toBe(true);
    expect(s.snapshot().dehydrated).toBe(true);
    at(1);
    expect(s.snapshot().ageYears).toBe(1);
    set({ celsius: 20 });
    at(1.01);
    expect(s.snapshot().events.some((e) => e.type === 'rehydration')).toBe(true);
    set({ celsius: -101 });
    at(1.02);
    expect(s.snapshot().alive).toBe(false);
    set({ celsius: 20 });
    at(1.1);
    expect(s.snapshot().alive).toBe(true);
    expect(s.snapshot().civilization).toBe(2);
  });
  it('keeps disasters instantaneous between virtual ticks and implements exact priority', () => {
    const { s, at, set } = fixture({ birthThreshold: 1 });
    at(0.02);
    set({ distancesAU: [0.1, 5, 5], starDistancesAU: [0.01, 5, 5], celsius: 500 });
    at(0.020001);
    expect(s.snapshot().records[0]?.cause).toBe('civil-roche');
    expect(s.snapshot().records[0]?.deathYear).toBeCloseTo(0.020001, 12);
  });
  it('implements planet/star civilization collisions independently of physical universe restarts', () => {
    const { s, at, set } = fixture({ birthThreshold: 1, civilRocheDistance: 0.001 });
    at(0.02);
    set({ distancesAU: [0.1, 5, 5] });
    at(0.021);
    expect(s.snapshot().records[0]?.cause).toBe('civil-planet-collision');
    set({ distancesAU: [5, 5, 5], starDistancesAU: [0.1, 5, 5] });
    at(0.1);
    expect(s.snapshot().records.at(-1)?.cause).toBe('civil-star-collision');
    expect(s.snapshot().ended).toBe(false);
  });
  it('logs birth and death with the same ID when both occur at one callback', () => {
    const { s, at, set } = fixture({ birthThreshold: 1 });
    set({ distancesAU: [0.1, 5, 5] });
    at(0.02);
    const a = s.snapshot();
    expect(a.events.find((e) => e.type === 'birth')?.civilization).toBe(1);
    expect(a.events.find((e) => e.type === 'death')?.civilization).toBe(1);
    expect(a.records[0]?.lifespan).toBe(0);
  });
  it('retains temperature destruction as cause with independently detected astronomical annotation', () => {
    const { s, at, set } = fixture({ birthThreshold: 1 });
    at(0.02);
    set({ celsius: -120, distancesAU: [1.5, 20, 20] });
    at(0.021);
    const a = s.snapshot();
    expect(a.records[0]?.cause).toBe('cold');
    expect(a.records[0]?.detail).toBe('sun1');
    expect(a.events.some((e) => e.type === 'flying2')).toBe(true);
  });
  it('uses separate continuous Kt clock, pauses when physical time stops and resets per universe', () => {
    const { s, at, b } = fixture({ birthThreshold: 1 });
    at(1);
    const before = s.snapshot();
    at(1);
    expect(s.snapshot()).toEqual(before);
    s.configure({ ...V04_DEFAULTS, civilizationTimeFactor: 20 }, false);
    at(2);
    expect(s.snapshot().civilYear).toBeCloseTo(5, 10);
    expect(s.snapshot().physicalYear).toBe(2);
    s.terminate({ type: 'escape', message: 'star escaped', bodyIds: ['star-0'] });
    const ended = s.snapshot();
    expect(ended.records.at(-1)?.cause).toBe('physical-escape');
    at(3);
    expect(s.snapshot()).toEqual(ended);
    s.reset(b, 2, 'next');
    expect(s.snapshot().civilization).toBe(1);
    expect(s.snapshot().civilYear).toBe(0);
    expect(s.snapshot().records).toHaveLength(0);
    expect(s.snapshot().sessionRanking).toHaveLength(1);
  });
  it('bounds all history and preserves top six independently of recent records', () => {
    const { s, at, set } = fixture({ birthThreshold: 1 });
    for (let i = 1; i <= 600; i++) {
      set({ celsius: 20 });
      at(i / 10);
      set({ celsius: 300 });
      at(i / 10 + 0.001);
    }
    const a = s.snapshot();
    expect(a.totalCivilizations).toBe(600);
    expect(a.events.length).toBe(CIVIL_EVENT_LIMIT);
    expect(a.records.length).toBe(CIVIL_HISTORY_LIMIT);
    expect(a.eras.length).toBeLessThanOrEqual(CIVIL_HISTORY_LIMIT);
    expect(a.ranking).toHaveLength(6);
    expect(a.sessionRanking).toHaveLength(6);
  });
  it('records original-style authenticity separately from scientific diagnostics', () => {
    const { s, at, set } = fixture({ birthThreshold: 50 });
    at(1);
    set({ celsius: 300 });
    at(1.1);
    expect(s.snapshot().records[0]?.annotation).toBe('TTDT');
  });
  it('does not suppress a short hot event with a large log interval or era confirmation', () => {
    const { s, at, set } = fixture({ birthThreshold: 1, logInterval: 10, eraConfirmationYears: 1 });
    at(0.02);
    set({ celsius: 500 });
    at(0.021);
    set({ celsius: 20 });
    at(0.022);
    expect(s.snapshot().events.some((e) => e.type === 'extreme-hot')).toBe(true);
    expect(s.snapshot().records).toHaveLength(1);
  });
});
it('registers and persists every relevant original parameter with valid defaults', () => {
  let saved: unknown;
  const persistence = {
    load: () => saved,
    save: (value: unknown) => {
      saved = value;
      return true;
    },
  };
  const s = new SettingsStore(persistence);
  for (const [k, r] of Object.entries(V04_RULES)) {
    expect(settingsRegistry.get(k as keyof typeof V04_RULES)).toBeDefined();
    expect(s.getSnapshot()[k as keyof typeof V04_RULES]).toBe(r.value);
  }
  s.set('randomPosRange', 2.333);
  s.set('temperatureDistanceFactor', 4.5);
  s.set('initial3VY', -0.123);
  s.set('rankOpacity5', 0.75);
  s.set('showRank', true);
  expect(new SettingsStore(persistence).getSnapshot()).toEqual(s.getSnapshot());
  expect(() => s.set('luminosityA', NaN)).toThrow();
});
it('closes a civilization exactly once at the last acknowledged state after a Worker failure', async () => {
  const { interruptCivilization } = await import('../src/environment/interrupted');
  const { s, at } = fixture({ birthThreshold: 1 });
  at(2);
  const ended = interruptCivilization(s.snapshot(), 'Worker failed');
  expect(ended.alive).toBe(false);
  expect(ended.records.at(-1)?.cause).toBe('physical-numerical');
  expect(ended.records.at(-1)?.deathYear).toBe(2);
  expect(interruptCivilization(ended, 'again')).toEqual(ended);
});

it('closes actual civilizations on physical collision and resets environmental histories on automatic restart', () => {
  const b = bodies();
  vi.spyOn(temperature, 'readEnvironment').mockReturnValue(reading());
  const e = new SimulationEngine('auto-civil', {
    initialBodies: b,
    generator: new OriginalRandomInitializer(),
    environment: { ...V04_DEFAULTS, birthThreshold: 1 },
    config: { galaxyScale: 3, cage: { ...DEFAULT_CAGE } },
  });
  e.setControls({ speed: 100, autoRestart: true, maxRestarts: 1 });
  e.advance(0.01);
  expect(e.snapshot().environment!.alive).toBe(true);
  const bs = e.getBodies();
  bs[1]!.position = [...bs[0]!.position];
  e.advance(0.01);
  expect(e.getReason()?.type).toBe('collision');
  expect(e.snapshot().environment!.records.at(-1)?.cause).toBe('physical-collision');
  const generation = e.getGeneration();
  for (let i = 0; i < 20 && e.getGeneration() === generation; i++) e.advance(0.25);
  const s = e.snapshot();
  expect(s.generation).toBe(generation + 1);
  expect(s.years).toBe(0);
  expect(s.environment!.records).toHaveLength(0);
  expect(s.environment!.civilization).toBe(1);
  expect(s.environment!.sessionRanking).toHaveLength(1);
});
it('does not turn visual preference changes into evolution changes', () => {
  const { s, at } = fixture({ birthThreshold: 1 });
  at(1);
  const n = s.snapshot().events.length;
  s.configure(
    { ...V04_DEFAULTS, birthThreshold: 1, showRank: true, logY: -3, rankOpacity1: 0.9 },
    false,
  );
  expect(s.snapshot().events).toHaveLength(n);
  s.configure({ ...V04_DEFAULTS, birthThreshold: 1, deathHigh: 250 }, false);
  expect(s.snapshot().events[0]?.type).toBe('configuration-change');
});

it('keeps pending initialization drafts out of the current evolution fingerprint', () => {
  const { s, at, set } = fixture({ birthThreshold: 1 });
  at(0.02);
  const n = s.snapshot().events.length;
  s.configure(
    { ...V04_DEFAULTS, birthThreshold: 1, randomPosRange: 3, planetMassOriginal: 2000 },
    false,
  );
  expect(s.snapshot().events).toHaveLength(n);
  set({ celsius: 300 });
  at(0.03);
  const r = s.snapshot().records[0]!;
  expect(r.birthConfigHash).toBe(r.deathConfigHash);
});
