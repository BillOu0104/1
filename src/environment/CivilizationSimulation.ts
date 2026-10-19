import { hashSeed } from '../physics/random';
import type { Body } from '../physics/types';
import { UNITS_PER_YEAR } from '../physics/types';
import type { EndReason } from '../physics/detection';
import { ORIGINAL_LENGTH_AU } from '../physics/originalInitializer';
import {
  V04_DEFAULTS,
  validateV04,
  evolutionInputs,
  INITIAL_KEYS,
  type V04Settings,
} from './config';
import { astronomicalCounts, classifyEra, EraMachine, type EraKind, type EraRecord } from './eras';
import { readEnvironment, type EnvironmentReading } from './temperature';
export const CIVIL_HISTORY_LIMIT = 256;
export const CIVIL_EVENT_LIMIT = 512;
export interface CivilizationRecord {
  number: number;
  generation: number;
  seed: string;
  version: '0.4.0';
  birthYear: number;
  deathYear: number;
  physicalLifespan: number;
  birthCivilYear: number;
  deathCivilYear: number;
  lifespan: number;
  cause: string;
  detail: string;
  annotation: string;
  birthConfigHash: string;
  deathConfigHash: string;
}
export interface CivilizationEvent {
  id: number;
  year: number;
  civilYear: number;
  civilization: number;
  type: string;
  detail?: string;
}
export interface CivilizationSnapshot {
  generation: number;
  seed: string;
  reading: EnvironmentReading;
  physicalYear: number;
  civilYear: number;
  alive: boolean;
  dehydrated: boolean;
  civilization: number;
  birthYear: number | null;
  ageYears: number;
  physicalAgeYears: number;
  suitableCount: number;
  ended: boolean;
  era: {
    kind: EraKind;
    raw: EraKind;
    startYear: number;
    durationYears: number;
    thermal: 'cold' | 'temperate' | 'hot';
  };
  events: readonly CivilizationEvent[];
  records: readonly CivilizationRecord[];
  ranking: readonly CivilizationRecord[];
  eras: readonly EraRecord[];
  sessionRanking: readonly CivilizationRecord[];
  totalCivilizations: number;
  sessionCivilizations: number;
  historyRevision: number;
}
const top = (items: readonly CivilizationRecord[]): CivilizationRecord[] =>
  [...items].sort((a, b) => b.lifespan - a.lifespan).slice(0, 6);
/** No force integration, renderer, wall clock, random development or universe restart here.
 * Original callback counter is adapted to 60 virtual callbacks per physical year.
 */
export class CivilizationSimulation {
  private config: V04Settings;
  private generation = -1;
  private seed = '';
  private lastTime = 0;
  private year = 0;
  private civilYear = 0;
  private nextTick = 1 / 60;
  private bornCivil = 0;
  private bornPhysical = 0;
  private number = 1;
  private alive = false;
  private dehydrated = false;
  private suitable = 0;
  private ended = false;
  private reading!: EnvironmentReading;
  private era!: EraMachine;
  private events: CivilizationEvent[] = [];
  private records: CivilizationRecord[] = [];
  private ranking: CivilizationRecord[] = [];
  private sessionRanking: CivilizationRecord[] = [];
  private eras: EraRecord[] = [];
  private total = 0;
  private sessionTotal = 0;
  private revision = 0;
  private eventId = 0;
  private lastAstronomy = '';
  private lastExtreme = '';
  private lastSummary = 0;
  private lastSummaryState = '';
  private cage = false;
  private birthConfigHash = '';
  private appliedInitial: Partial<V04Settings> = {};
  private configHash(): string {
    return hashSeed(JSON.stringify({ ...evolutionInputs(this.config), ...this.appliedInitial }))
      .toString(16)
      .padStart(8, '0');
  }
  constructor(
    config: V04Settings = V04_DEFAULTS,
    session?: { ranking: readonly CivilizationRecord[]; total: number },
  ) {
    validateV04(config);
    this.config = { ...config };
    if (session) {
      this.sessionRanking = top(session.ranking);
      this.sessionTotal = session.total;
    }
  }
  configure(config: V04Settings, cage: boolean): void {
    validateV04(config);
    const before = this.configHash(),
      oldCage = this.cage;
    this.config = { ...config };
    this.cage = cage;
    const changed = before !== this.configHash() || oldCage !== cage;
    if (changed && this.generation >= 0 && !this.ended)
      this.log('configuration-change', this.configHash());
  }
  reset(bodies: readonly Body[], generation: number, seed: string, cage = false): void {
    this.appliedInitial = Object.fromEntries(INITIAL_KEYS.map((k) => [k, this.config[k]]));
    this.generation = generation;
    this.seed = seed;
    this.cage = cage;
    this.lastTime =
      this.year =
      this.civilYear =
      this.bornCivil =
      this.bornPhysical =
      this.suitable =
        0;
    this.nextTick = 1 / 60;
    this.number = 1;
    this.alive = this.ended = false;
    this.events = [];
    this.records = [];
    this.ranking = [];
    this.eras = [];
    this.total = 0;
    this.lastAstronomy = this.lastExtreme = this.lastSummaryState = '';
    this.lastSummary = 0;
    this.reading = readEnvironment(bodies, 0, this.config);
    this.era = new EraMachine(classifyEra(this.reading, this.config));
    this.dehydrated = this.reading.celsius < -50 || this.reading.celsius > 70;
    this.log('universe-start');
    this.log(`era:${this.era.kind}`);
    this.monitor(bodies);
  }
  observe(bodies: readonly Body[], time: number): void {
    if (this.ended || time < this.lastTime || !Number.isFinite(time)) return;
    const startYear = this.year,
      startCivil = this.civilYear,
      year = time / UNITS_PER_YEAR;
    const rate = (this.config.civilizationTimeFactor / 10) ** 2;
    this.reading = readEnvironment(bodies, time, this.config);
    // Bounded by accepted physical steps, independent of target speed and RAF. 60/year.
    while (this.nextTick <= year + 1e-12) {
      this.year = this.nextTick;
      this.civilYear = startCivil + (this.year - startYear) * rate;
      const suitable =
        this.reading.celsius >= this.config.deathLow &&
        this.reading.celsius <= this.config.deathHigh;
      if (suitable) {
        this.suitable++;
        if (!this.alive && this.suitable >= Math.ceil(this.config.birthThreshold)) {
          this.alive = true;
          this.suitable = 0;
          this.bornCivil = Math.floor(this.civilYear);
          this.bornPhysical = this.year;
          this.birthConfigHash = this.configHash();
          this.log('birth');
          this.dehydrated = this.reading.celsius < -50 || this.reading.celsius > 70;
          this.log(this.dehydrated ? 'dehydration' : 'rehydration');
        }
      } else this.suitable = 0;
      // A birth and a distance disaster can occur in one original callback. Log both atomically.
      this.killIfHostile(bodies);
      this.nextTick += 1 / 60;
    }
    this.year = year;
    this.civilYear = startCivil + (year - startYear) * rate;
    this.lastTime = time;
    if (this.reading.celsius < this.config.deathLow || this.reading.celsius > this.config.deathHigh)
      this.suitable = 0;
    this.monitor(bodies);
    this.killIfHostile(bodies);
    if (Math.floor(this.civilYear) >= this.lastSummary + this.config.logInterval) {
      const state = `${this.era.kind}:${this.dehydrated}:${this.alive}`;
      if (this.alive && state !== this.lastSummaryState) this.log('status', state);
      this.lastSummaryState = state;
      this.lastSummary = Math.floor(this.civilYear);
    }
  }
  private monitor(_bodies: readonly Body[]): void {
    const old = this.era.observe(
      classifyEra(this.reading, this.config),
      this.year,
      this.config.eraConfirmationYears,
    );
    if (old) {
      this.eras = [...this.eras, old].slice(-CIVIL_HISTORY_LIMIT);
      this.log(`era:${this.era.kind}`);
    }
    const a = astronomicalCounts(this.reading, this.config),
      astronomy = `${a.overhead}:${a.flying}`;
    if (astronomy !== this.lastAstronomy) {
      if (a.overhead) this.log(`sun${a.overhead}`);
      if (a.flying) this.log(`flying${a.flying}`);
      this.lastAstronomy = astronomy;
    }
    const extreme =
      this.reading.celsius < this.config.deathLow
        ? 'extreme-cold'
        : this.reading.celsius > this.config.deathHigh
          ? 'extreme-hot'
          : '';
    if (extreme !== this.lastExtreme) {
      if (extreme) this.log(extreme);
      this.lastExtreme = extreme;
    }
    const dehydrated = this.reading.celsius < -50 || this.reading.celsius > 70;
    if (dehydrated !== this.dehydrated) {
      this.dehydrated = dehydrated;
      if (this.alive) this.log(dehydrated ? 'dehydration' : 'rehydration');
    }
  }
  private killIfHostile(_bodies: readonly Body[]): void {
    if (!this.alive) return;
    const c = this.config,
      r = this.reading;
    const near = r.distancesAU.flatMap((d, i) =>
      d < c.civilRocheDistance * ORIGINAL_LENGTH_AU ? [i] : [],
    );
    if (near.length) {
      this.destroy('civil-roche', near.map((i) => 'ABC'[i]).join(','));
      return;
    }
    const collisions = r.distancesAU.flatMap((d, i) =>
      d < c.civilCollisionDistance * ORIGINAL_LENGTH_AU ? [i] : [],
    );
    if (collisions.length) {
      this.destroy('civil-planet-collision', collisions.map((i) => 'ABC'[i]).join(','));
      return;
    }
    const starCollisions = r.starDistancesAU.flatMap((d, i) =>
      d < c.civilCollisionDistance * ORIGINAL_LENGTH_AU ? [i] : [],
    );
    if (starCollisions.length) {
      this.destroy(
        'civil-star-collision',
        starCollisions.map((i) => ['A/B', 'A/C', 'B/C'][i]).join(','),
      );
      return;
    }
    if (r.celsius < c.deathLow || r.celsius > c.deathHigh) {
      const a = astronomicalCounts(r, c);
      this.destroy(
        r.celsius < c.deathLow ? 'cold' : 'hot',
        a.overhead ? `sun${a.overhead}` : a.flying ? `flying${a.flying}` : '',
      );
    }
  }
  terminate(reason: EndReason | { type: 'manual'; message: string }): void {
    if (this.ended) return;
    if (this.alive) this.destroy(`physical-${reason.type}`, reason.message);
    this.ended = true;
    this.suitable = 0;
    this.eras = [
      ...this.eras,
      {
        kind: this.era.kind,
        startYear: this.era.startYear,
        endYear: this.year,
        durationYears: this.year - this.era.startYear,
      },
    ].slice(-CIVIL_HISTORY_LIMIT);
    this.log('universe-end', reason.message);
  }
  private annotation(): string {
    const c = this.config;
    const defaults =
      c.deathHigh === 200 &&
      c.deathLow === -100 &&
      c.overheadDistance === 0.3 &&
      c.flyingDistance === 2 &&
      c.flyingTemperature === -70 &&
      c.civilRocheDistance === 0.21 &&
      c.civilCollisionDistance === 0.2 &&
      c.logInterval === 5 &&
      c.birthThreshold === 50;
    return `${c.civilizationTimeFactor === 10 ? 'T' : 'F'}${this.cage ? 'F' : 'T'}${c.temperatureDistanceFactor === 1 ? 'T' : c.temperatureDistanceFactor < 6 ? 'C' : c.temperatureDistanceFactor <= 7 ? 'D' : 'F'}${defaults ? 'T' : 'C'}`;
  }
  private destroy(cause: string, detail = ''): void {
    const record: CivilizationRecord = {
      number: this.number,
      generation: this.generation,
      seed: this.seed,
      version: '0.4.0',
      birthYear: this.bornPhysical,
      deathYear: this.year,
      physicalLifespan: Math.max(0, this.year - this.bornPhysical),
      birthCivilYear: this.bornCivil,
      deathCivilYear: Math.floor(this.civilYear),
      lifespan: Math.max(0, Math.floor(this.civilYear) - this.bornCivil),
      cause,
      detail,
      annotation: this.annotation(),
      birthConfigHash: this.birthConfigHash,
      deathConfigHash: this.configHash(),
    };
    this.records = [...this.records, record].slice(-CIVIL_HISTORY_LIMIT);
    this.ranking = top([...this.ranking, record]);
    this.sessionRanking = top([...this.sessionRanking, record]);
    this.total++;
    this.sessionTotal++;
    this.log('death', `${cause}${detail ? ': ' + detail : ''}`);
    this.alive = false;
    this.number++;
  }
  private log(type: string, detail?: string): void {
    this.events = [
      {
        id: ++this.eventId,
        year: this.year,
        civilYear: this.civilYear,
        civilization: this.number,
        type,
        detail,
      },
      ...this.events,
    ].slice(0, CIVIL_EVENT_LIMIT);
    this.revision++;
  }
  snapshot(): CivilizationSnapshot {
    return {
      generation: this.generation,
      seed: this.seed,
      reading: {
        ...this.reading,
        distancesAU: [...this.reading.distancesAU],
        starDistancesAU: [...this.reading.starDistancesAU],
      },
      physicalYear: this.year,
      civilYear: this.civilYear,
      alive: this.alive,
      dehydrated: this.dehydrated,
      civilization: this.number,
      birthYear: this.alive ? this.bornPhysical : null,
      ageYears: this.alive
        ? Math.max(0, Math.floor(this.civilYear) - this.bornCivil)
        : (this.records.at(-1)?.lifespan ?? 0),
      physicalAgeYears: this.alive
        ? this.year - this.bornPhysical
        : (this.records.at(-1)?.physicalLifespan ?? 0),
      suitableCount: this.suitable,
      ended: this.ended,
      era: {
        kind: this.era.kind,
        raw: this.era.raw,
        startYear: this.era.startYear,
        durationYears: this.year - this.era.startYear,
        thermal:
          this.reading.celsius < -50 ? 'cold' : this.reading.celsius > 70 ? 'hot' : 'temperate',
      },
      events: this.events,
      records: this.records,
      ranking: this.ranking,
      eras: this.eras,
      sessionRanking: this.sessionRanking,
      totalCivilizations: this.total,
      sessionCivilizations: this.sessionTotal,
      historyRevision: this.revision,
    };
  }
}
