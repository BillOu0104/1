import type { CSSProperties } from 'react';
import type {
  CivilizationSnapshot,
  CivilizationRecord,
} from '../../environment/CivilizationSimulation';
import type { V04Settings } from '../../environment/config';
import { environmentLabel as label, eventDetail, formatCivilYears } from '../../environment/labels';
const localLayout = (
  x: number,
  y: number,
  size: number,
  defaultY: number,
  defaultSize: number,
): CSSProperties => ({
  transform: `translate(${x * 2}px, ${(y - defaultY) * 2}px)`,
  fontSize: `${Math.max(0.5, size / defaultSize)}em`,
  display: size === 0 ? 'none' : undefined,
});
export function CivilizationStatus({
  state,
  settings: c,
}: {
  state: CivilizationSnapshot;
  settings: V04Settings;
}) {
  const en = c.civilizationEnglish;
  return (
    <section
      className="civilization-status"
      aria-label="文明实时状态"
      hidden={!c.showCivilization}
      style={localLayout(c.logX, c.logY, c.logSize, 0.36, 0.9)}
    >
      <dl className="data-list" style={{ opacity: c.statusOpacity }}>
        <div>
          <dt>{en ? 'Era' : '当前纪元'}</dt>
          <dd>
            {label(state.era.kind, en)}
            {state.era.kind === 'stable' &&
              (state.era.thermal === 'hot'
                ? ' · 高温'
                : state.era.thermal === 'cold'
                  ? ' · 低温'
                  : '')}
          </dd>
        </div>
        <div>
          <dt>{en ? 'Era Duration' : '纪元持续'}</dt>
          <dd>
            {state.era.durationYears.toFixed(3)} {en ? 'physical yr' : '物理年'}
          </dd>
        </div>
        <div>
          <dt>{en ? 'Civilization' : '文明状态'}</dt>
          <dd>
            {state.alive
              ? label(state.dehydrated ? 'dehydration' : 'rehydration', en)
              : en
                ? 'Awaiting Birth'
                : '等待诞生'}
          </dd>
        </div>
        <div>
          <dt>{en ? 'Civilization No.' : '文明编号'}</dt>
          <dd>#{state.civilization}</dd>
        </div>
        <div>
          <dt>{en ? 'Temperature' : '行星实时温度'}</dt>
          <dd data-testid="planet-temperature">
            {state.reading.celsius.toFixed(2)} °C / {state.reading.kelvin.toFixed(2)} K
          </dd>
        </div>
      </dl>
      <dl className="data-list" style={{ opacity: c.lifeOpacity }}>
        <div>
          <dt>
            {state.alive ? (en ? 'Age' : '文明生存时间') : en ? 'Last Lifespan' : '上代文明寿命'}
          </dt>
          <dd>
            {formatCivilYears(state.ageYears)} {en ? 'civil yr' : '文明年'}
          </dd>
        </div>
        <div>
          <dt>{en ? 'Physical Lifetime' : '对应物理寿命'}</dt>
          <dd>
            {state.physicalAgeYears.toFixed(3)} {en ? 'yr' : '年'}
          </dd>
        </div>
        <div>
          <dt>{en ? 'Civilization Clock' : '文明纪年'}</dt>
          <dd>{state.civilYear.toFixed(3)}</dd>
        </div>
        <div>
          <dt>{en ? 'Suitable Count' : '连续适宜计数'}</dt>
          <dd>
            {state.suitableCount} / {Math.ceil(c.birthThreshold)}
          </dd>
        </div>
      </dl>
      <div className="panel-section-title">{en ? 'CIVILIZATION LOG' : '文明事件日志'}</div>
      <ol className="event-list" aria-label="文明事件日志">
        {state.events.slice(0, 5).map((event, i) => (
          <li
            key={event.id}
            style={{ opacity: Number(c[`eventOpacity${i}` as keyof V04Settings]) }}
          >
            <span>
              {event.year.toFixed(3)} {en ? 'PHYSICAL YR' : '物理年'} ·{' '}
              {formatCivilYears(event.civilYear)} {en ? 'CIV YR' : '文明年'} · #{event.civilization}
            </span>
            <p>
              {label(event.type, en)} {eventDetail(event.detail, en)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
export function CivilizationRanking({
  state,
  settings: c,
}: {
  state: CivilizationSnapshot;
  settings: V04Settings;
}) {
  const en = c.civilizationEnglish;
  const rows = (records: readonly CivilizationRecord[]) => (
    <ol className="civil-rank-list">
      {records.map((r, i) => (
        <li
          key={`${r.generation}-${r.number}`}
          style={{ opacity: Number(c[`rankOpacity${i}` as keyof V04Settings]) }}
        >
          <span>
            #{r.number} · {formatCivilYears(r.lifespan)} {en ? 'civil yr' : '文明年'} /{' '}
            {r.physicalLifespan.toFixed(3)} {en ? 'physical yr' : '物理年'}
          </span>
          <small>
            {label(r.cause, en)} {eventDetail(r.detail, en)}
          </small>
          <small>
            SEED {r.seed} · {en ? 'Universe' : '宇宙'} {r.generation}
            {c.authenticity ? ` · ${r.annotation} · V${r.version}` : ''}
          </small>
        </li>
      ))}
    </ol>
  );
  return (
    <section
      aria-label="文明历史排行"
      hidden={!c.showRank}
      style={localLayout(c.rankX, c.rankY, c.rankSize, 1.8, 1)}
    >
      <div className="panel-section-title" style={{ opacity: c.rankHeadingOpacity }}>
        {en ? 'CIVILIZATION RANK · THIS UNIVERSE' : '文明寿命排行 · 当前宇宙'}
      </div>
      {state.ranking.length ? (
        rows(state.ranking)
      ) : (
        <p className="muted">{en ? 'No completed civilization' : '尚无已结束的文明'}</p>
      )}
      <details>
        <summary>{en ? 'Session Top 6' : '会话累计前六名'}</summary>
        {rows(state.sessionRanking)}
      </details>
    </section>
  );
}
