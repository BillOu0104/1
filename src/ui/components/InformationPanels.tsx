import type { SimulationSnapshot } from '../../simulation/SimulationEngine';
import { length } from '../../physics/vector';
export function InformationPanels({
  snapshot,
  visible,
}: {
  snapshot: SimulationSnapshot;
  visible: boolean;
}) {
  return (
    <div id="information-panels" className="information-panels" hidden={!visible}>
      <aside className="info-panel left-panel" aria-label="行星与事件信息">
        <header>
          <span className="section-index">01 / PLANET</span>
          <span className="status-dot" />
          观测中
        </header>
        <h1>
          PEREGRINE<span>行星 01 · 逐星者</span>
        </h1>
        <dl className="data-list">
          <div>
            <dt>文明状态</dt>
            <dd className="muted">待开发</dd>
          </div>
          <div>
            <dt>行星温度</dt>
            <dd className="muted">尚无估算模型</dd>
          </div>
          <div>
            <dt>行星质量</dt>
            <dd>{snapshot.bodies.find((b) => b.kind === 'planet')?.mass.toExponential(3)} M☉</dd>
          </div>
          <div>
            <dt>运行轮次</dt>
            <dd>{String(snapshot.generation).padStart(3, '0')}</dd>
          </div>
        </dl>
        <div className="panel-section-title">
          SYSTEM EVENT LOG <span>系统事件</span>
        </div>
        <ol className="event-list">
          {snapshot.events.slice(0, 12).map((event) => (
            <li key={event.id}>
              <span>
                {event.years.toFixed(3)} YR <b>{event.type.toUpperCase()}</b>
              </span>
              <p>{event.message}</p>
              <small>SEED {event.seed}</small>
            </li>
          ))}
        </ol>
        <p className="panel-footnote">
          文明事件与排行模块待开发。
          <br />
          当前仅记录真实模拟事件。
        </p>
      </aside>
      <aside className="info-panel right-panel" aria-label="天体与物理统计">
        <header>
          <span className="section-index">02 / TELEMETRY</span>
          <span>LIVE DATA</span>
        </header>
        <h2>
          引力遥测<span>GRAVITATIONAL SYSTEM</span>
        </h2>
        <div className="body-list">
          {snapshot.bodies.map((body) => (
            <article key={body.id} className="body-row">
              <i style={{ background: body.color, boxShadow: `0 0 12px ${body.color}55` }} />
              <div>
                <h3>{body.name}</h3>
                <p>
                  {body.mass.toPrecision(3)} M☉ <span>｜</span> {length(body.velocity).toFixed(3)}{' '}
                  V₀
                </p>
              </div>
              <span>
                {length(body.position).toFixed(2)}
                <small>AU · 距原点</small>
              </span>
            </article>
          ))}
        </div>
        <div className="panel-section-title">
          PHYSICS <span>积分统计</span>
        </div>
        <dl className="data-list">
          <div>
            <dt>积分器</dt>
            <dd>{snapshot.integrator}</dd>
          </div>
          <div>
            <dt>当前 / 最小步长</dt>
            <dd>
              {snapshot.diagnostics.lastStep.toExponential(1)} /{' '}
              {snapshot.diagnostics.minStep.toExponential(1)} T₀
            </dd>
          </div>
          <div>
            <dt>已计算步数</dt>
            <dd>{snapshot.steps.toLocaleString()}</dd>
          </div>
          <div>
            <dt>能量相对偏差</dt>
            <dd>
              {Number.isFinite(snapshot.relativeEnergyError)
                ? `${(snapshot.relativeEnergyError * 100).toExponential(2)} %`
                : '异常'}
            </dd>
          </div>
          <div>
            <dt>丢弃模拟时间</dt>
            <dd>{snapshot.droppedTime.toFixed(3)} T₀</dd>
          </div>
          <div>
            <dt>动量误差</dt>
            <dd>{snapshot.diagnostics.momentumError.toExponential(2)}</dd>
          </div>
          <div>
            <dt>角动量误差</dt>
            <dd>{snapshot.diagnostics.angularMomentumError.toExponential(2)}</dd>
          </div>
          <div>
            <dt>近距离交会 / 邻居交换</dt>
            <dd>
              {snapshot.diagnostics.encounters} / {snapshot.diagnostics.exchanges}
            </dd>
          </div>
          <div>
            <dt>潮汐风险 / 阈值</dt>
            <dd>
              {snapshot.tidal?.ratio.toExponential(2) ?? '—'} /{' '}
              {snapshot.tidal?.threshold.toFixed(3) ?? '—'}
            </dd>
          </div>
          <div>
            <dt>单次物理计算</dt>
            <dd>
              {snapshot.diagnostics.cpuMs.toFixed(2)} ms
              {snapshot.diagnostics.limited ? ' · 已限流' : ''}
            </dd>
          </div>
          <div>
            <dt>初始条件</dt>
            <dd>Random · Seed</dd>
          </div>
          <div>
            <dt>累计重启</dt>
            <dd>{snapshot.restartCount}</dd>
          </div>
        </dl>
        <div className="chart-placeholder">轨道与文明状态图表 · 待开发</div>
      </aside>
    </div>
  );
}
