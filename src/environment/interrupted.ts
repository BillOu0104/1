import {
  CIVIL_EVENT_LIMIT,
  CIVIL_HISTORY_LIMIT,
  type CivilizationSnapshot,
  type CivilizationRecord,
} from './CivilizationSimulation';
/** Worker failure: close at the last acknowledged physical state, never invent unreceived time. */
export function interruptCivilization(
  s: CivilizationSnapshot,
  message: string,
): CivilizationSnapshot {
  if (s.ended) return s;
  const record: CivilizationRecord | null =
    s.alive && s.birthYear !== null
      ? {
          number: s.civilization,
          generation: s.generation,
          seed: s.seed,
          version: '0.4.0',
          birthYear: s.birthYear,
          deathYear: s.physicalYear,
          physicalLifespan: s.physicalAgeYears,
          birthCivilYear: Math.floor(s.civilYear) - s.ageYears,
          deathCivilYear: Math.floor(s.civilYear),
          lifespan: s.ageYears,
          cause: 'physical-numerical',
          detail: message,
          annotation: 'unknown',
          birthConfigHash: 'last-acknowledged',
          deathConfigHash: 'worker-interrupted',
        }
      : null;
  const rank = (a: readonly CivilizationRecord[]) =>
    [...a].sort((x, y) => y.lifespan - x.lifespan).slice(0, 6);
  const id = Math.max(0, ...s.events.map((e) => e.id)) + 1;
  const events = [
    {
      id: id + 1,
      year: s.physicalYear,
      civilYear: s.civilYear,
      civilization: s.civilization,
      type: 'universe-end',
      detail: message,
    },
    ...(record
      ? [
          {
            id,
            year: s.physicalYear,
            civilYear: s.civilYear,
            civilization: s.civilization,
            type: 'death',
            detail: `physical-numerical: ${message}`,
          },
        ]
      : []),
    ...s.events,
  ].slice(0, CIVIL_EVENT_LIMIT);
  return {
    ...s,
    ended: true,
    alive: false,
    civilization: s.civilization + (record ? 1 : 0),
    birthYear: null,
    suitableCount: 0,
    events,
    records: record ? [...s.records, record].slice(-CIVIL_HISTORY_LIMIT) : s.records,
    ranking: record ? rank([...s.ranking, record]) : s.ranking,
    sessionRanking: record ? rank([...s.sessionRanking, record]) : s.sessionRanking,
    totalCivilizations: s.totalCivilizations + (record ? 1 : 0),
    sessionCivilizations: s.sessionCivilizations + (record ? 1 : 0),
    eras: [
      ...s.eras,
      {
        kind: s.era.kind,
        startYear: s.era.startYear,
        endYear: s.physicalYear,
        durationYears: s.era.durationYears,
      },
    ].slice(-CIVIL_HISTORY_LIMIT),
    historyRevision: s.historyRevision + 1,
  };
}
