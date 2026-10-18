import type { NumericSettingKey, BooleanSettingKey } from '../../settings/types';
import { CAGE_LENGTH_AU, CAGE_MASS_SOLAR } from '../../physics/cage';
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
  const numeric = (key: keyof typeof settings): key is NumericSettingKey =>
    typeof settings[key] === 'number';
  const boolean = (key: keyof typeof settings): key is BooleanSettingKey =>
    typeof settings[key] === 'boolean';
  const unit = (key: NumericSettingKey) =>
    key === 'speed' || key === 'galaxyScale'
      ? '×'
      : key === 'trailLengthYears'
        ? ' 模拟年'
        : ['massA', 'massB', 'massC'].includes(key)
          ? ' M☉'
          : '';
  const help = (key: NumericSettingKey): string => {
    if (key === 'speed') return '1× ≈ 0.095 模拟年/秒；高负载时放慢推进。';
    if (key === 'trailLengthYears') return '按模拟时间保留，立即生效；每颗天体最多 8192 点。';
    if (key === 'galaxyScale')
      return `位置×k，速度÷√k；下一次重置生效，当前 ${snapshot.system?.galaxyScale ?? 1}×。物理年份不变。`;
    if (key === 'cageMass')
      return `原版质量单位；当前等效 ${(settings.cageMass * CAGE_MASS_SOLAR).toFixed(3)} M☉。`;
    if (key === 'cageRe' || key === 'cageRc' || key === 'cageHardRadius')
      return `原版距离单位；本轮 ${(settings[key] * CAGE_LENGTH_AU * (snapshot.system?.galaxyScale ?? settings.galaxyScale)).toFixed(3)} AU。${key === 'cageHardRadius' ? '仅硬模式生效。' : ''}`;
    if (key === 'cageExponent') return '仅软模式生效；保留原版小数指数。';
    if (key === 'cageK1') return '相对质心的内区斥力，不是天体间斥力。';
    if (key === 'cageK2') return '外区拉回强度；0 表示没有外部束缚。';
    return '质量会在参考值附近随机 ±3%；重置后生效。';
  };
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
            模拟设置 <small>V0.3</small>
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
                  if (definition.kind === 'number' && numeric(definition.key))
                    return (
                      <div className="range-field" key={id}>
                        <label htmlFor={id}>
                          {definition.label}
                          <output>
                            {settings[definition.key].toFixed(
                              definition.key === 'galaxyScale' || definition.key === 'cageMass'
                                ? 0
                                : definition.key.startsWith('cage')
                                  ? 3
                                  : definition.key === 'speed' ||
                                      definition.key === 'trailLengthYears'
                                    ? 1
                                    : 2,
                            )}
                            {unit(definition.key)}
                          </output>
                        </label>
                        <input
                          id={id}
                          type="range"
                          disabled={
                            (definition.key === 'cageHardRadius' && !settings.cageHard) ||
                            (definition.key === 'cageExponent' && settings.cageHard)
                          }
                          min={definition.min}
                          max={definition.max}
                          step={definition.step}
                          value={settings[definition.key]}
                          onChange={(event) =>
                            store.set(
                              definition.key as NumericSettingKey,
                              Number(event.target.value),
                            )
                          }
                        />
                        <small>{help(definition.key)}</small>
                      </div>
                    );
                  if (definition.kind === 'boolean' && boolean(definition.key)) {
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
              {category === '引力牢笼' && (
                <small>
                  {settings.cageEnabled
                    ? '非纯牛顿系统：额外质心约束已开启，能量按外力做功修正。'
                    : '纯牛顿引力：额外约束已关闭。'}
                  参数立即生效；不反射或锁定轨道。
                </small>
              )}
              {category === '初始条件' && (
                <button className="reset-button" onClick={onReset}>
                  应用尺度并重置
                </button>
              )}
              {category === '天体参数' && (
                <>
                  <button className="reset-button" onClick={onReset}>
                    应用质量并重置
                  </button>
                  <button
                    className="reset-button"
                    onClick={() => {
                      store.set('massA', 1.1);
                      store.set('massB', 0.94);
                      store.set('massC', 0.12);
                      onReset();
                    }}
                  >
                    采用 α Cen 参考质量
                  </button>
                  <small>仅参考质量；不会使用现实中的层级轨道。地球质量与半径为模拟假设。</small>
                </>
              )}
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
