import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SettingsStore } from '../../settings/SettingsStore';
import { features } from '../../features/FeatureRegistry';
import type { SimulationSnapshot } from '../../simulation/SimulationEngine';
export function SettingsPanel({
  store,
  snapshot,
  onReset,
  onClose,
}: {
  store: SettingsStore;
  snapshot: SimulationSnapshot;
  onReset: () => void;
  onClose: () => void;
}) {
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [draftSeed, setDraftSeed] = useState(settings.seed);
  const [seedError, setSeedError] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const definitions = store.registry.getDefinitions();
  const categories = [...new Set(definitions.map((d) => d.category))];
  return (
    <section
      className="settings-panel"
      aria-label="模拟设置"
      id="settings-panel"
      ref={panelRef}
      tabIndex={-1}
    >
      <header className="settings-header">
        <div>
          <span className="eyebrow">CONTROL CENTER</span>
          <h2>
            模拟设置 <small>V0.1</small>
          </h2>
        </div>
        <button onClick={onClose} aria-label="关闭设置">
          ×
        </button>
      </header>
      <div className="settings-scroll">
        {categories.map((category) => (
          <details key={category} open>
            <summary>{category}</summary>
            <div className="settings-group">
              {definitions
                .filter((d) => d.category === category)
                .map((definition) => {
                  const id = `setting-${definition.key}`;
                  if (definition.kind === 'seed')
                    return (
                      <div className="seed-field" key={id}>
                        <label htmlFor={id}>{definition.label}</label>
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            const trimmed = draftSeed.trim();
                            if (!store.registry.get('seed')?.validate(trimmed)) {
                              setSeedError('Seed 需要 1–80 个字符');
                              return;
                            }
                            store.set('seed', trimmed);
                            setDraftSeed(trimmed);
                            setSeedError('');
                            onReset();
                          }}
                        >
                          <input
                            id={id}
                            value={draftSeed}
                            maxLength={80}
                            onChange={(event) => setDraftSeed(event.target.value)}
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <button type="submit">应用并重置</button>
                        </form>
                        {seedError && <small role="alert">{seedError}</small>}
                        <small>
                          当前运行 Seed：<code>{snapshot.seed}</code>
                        </small>
                      </div>
                    );
                  if (definition.kind === 'number' && definition.key === 'speed')
                    return (
                      <div className="range-field" key={id}>
                        <label htmlFor={id}>
                          {definition.label}
                          <output>{settings.speed.toFixed(1)}×</output>
                        </label>
                        <input
                          id={id}
                          type="range"
                          min={definition.min}
                          max={definition.max}
                          step={definition.step}
                          value={settings.speed}
                          onChange={(event) => store.set('speed', Number(event.target.value))}
                        />
                        <small>1× = 每秒约 0.095 模拟年；性能不足时限制步数。</small>
                      </div>
                    );
                  if (
                    definition.kind === 'boolean' &&
                    (definition.key === 'paused' ||
                      definition.key === 'autoRestart' ||
                      definition.key === 'trails')
                  ) {
                    const key = definition.key;
                    return (
                      <label className="toggle-row" htmlFor={id} key={id}>
                        <span>{definition.label}</span>
                        <input
                          id={id}
                          type="checkbox"
                          checked={settings[key]}
                          onChange={(event) => store.set(key, event.target.checked)}
                        />
                      </label>
                    );
                  }
                  return null;
                })}
              {category === '运行控制' && (
                <button className="reset-button" onClick={onReset}>
                  ↻ 手动重置 <span>使用已保存 Seed</span>
                </button>
              )}
            </div>
          </details>
        ))}
        {!store.persistenceAvailable && (
          <p role="status" className="persistence-warning">
            当前浏览器无法保存设置，本次修改仅在当前页面有效。
          </p>
        )}
        <details className="future-features">
          <summary>扩展模块与开发状态</summary>
          <ul>
            {features.list().map((feature) => (
              <li key={feature.id}>
                <strong>
                  {feature.label}
                  <span>
                    {feature.status === 'implemented'
                      ? '已实现'
                      : feature.status === 'partial'
                        ? '部分实现'
                        : '待开发'}
                  </span>
                </strong>
                <p>{feature.description}</p>
              </li>
            ))}
          </ul>
        </details>
        <p className="settings-note">
          物理单位：AU / M☉ / T₀，G = 1。
          <br />
          恒星未锁定轨道；每轮结果由真实数值积分产生。
        </p>
      </div>
    </section>
  );
}
