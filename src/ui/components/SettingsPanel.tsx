import type { NumericSettingKey, BooleanSettingKey } from '../../settings/types';
import { CAGE_LENGTH_AU, CAGE_MASS_SOLAR } from '../../physics/cage';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SettingsStore } from '../../settings/SettingsStore';
import { features } from '../../features/FeatureRegistry';
import type { SimulationSnapshot } from '../../simulation/SimulationEngine';
import { NumericSetting } from './NumericSetting';
export function SettingsPanel({
  store,
  snapshot,
  onReset,
  onRerun,
  onClose,
}: {
  store: SettingsStore;
  snapshot: SimulationSnapshot;
  onReset: () => void;
  onRerun: () => void;
  onClose: () => void;
}) {
  const settings = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [draftSeed, setDraftSeed] = useState(settings.seed);
  const [seedError, setSeedError] = useState('');
  useEffect(() => setDraftSeed(settings.seed), [settings.seed]);
  const [expanded, setExpanded] = useState(
    () => new Set(['运行控制', '初始条件', '天体参数', '引力牢笼', '轨道外观']),
  );
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
    if (key === 'speed')
      return `目标 ${settings.speed.toFixed(1)}×；近期实际 ${(settings.paused || snapshot.phase !== 'running' ? 0 : snapshot.diagnostics.achievedSpeed).toFixed(1)}×。1× ≈ 0.095 模拟年/秒；高负载时保留精度、放慢推进。`;
    if (key === 'maxRestarts')
      return '0 仅运行最初一轮；只计自动重启。重新开始比赛会清零。滑块常用范围 0–100，可输入更大的安全整数。';
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
    return ['massA', 'massB', 'massC'].includes(key)
      ? '恒星质量精确采用参考设置；重置后生效。'
      : '';
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
            模拟设置 <small>V0.4</small>
          </h2>
        </div>
        <button onClick={onClose} aria-label="关闭设置">
          ×
        </button>
      </header>
      <div className="settings-scroll">
        {categories.map((category) => (
          <details
            key={category}
            open={expanded.has(category)}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              setExpanded((old) => {
                if (old.has(category) === open) return old;
                const next = new Set(old);
                if (open) next.add(category);
                else next.delete(category);
                return next;
              });
            }}
          >
            <summary>{category}</summary>
            {expanded.has(category) && (
              <div className="settings-group">
                {definitions
                  .filter((d) => d.category === category)
                  .map((definition) => {
                    const id = `setting-${definition.key}`;
                    if (
                      ['seed', 'unlimitedRestarts', 'maxRestarts'].includes(definition.key) &&
                      settings.seedMode !== 'fixed'
                    )
                      return null;
                    if (definition.key === 'seedMode')
                      return (
                        <div className="seed-mode-field" key={id}>
                          <label htmlFor={id}>Seed 模式</label>
                          <select
                            id={id}
                            value={settings.seedMode}
                            onChange={(event) =>
                              store.set('seedMode', event.target.value as 'random' | 'fixed')
                            }
                          >
                            <option value="random">随机模式（默认）</option>
                            <option value="fixed">固定 Seed 模式</option>
                          </select>
                          <small>
                            下一次手动重置生效。随机模式每轮使用新
                            Seed；固定模式自动轮次使用确定性序列。
                          </small>
                        </div>
                      );
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
                        </div>
                      );
                    if (definition.kind === 'number' && numeric(definition.key))
                      return (
                        <NumericSetting
                          key={id}
                          id={id}
                          label={definition.label}
                          unit={unit(definition.key)}
                          description={definition.description ?? help(definition.key)}
                          sliderMax={
                            definition.key === 'maxRestarts'
                              ? Math.max(100, settings.maxRestarts)
                              : undefined
                          }
                          disabled={
                            (definition.key.startsWith('initial') && !settings.customInitial) ||
                            (['randomPosRange', 'randomSpeedRange'].includes(definition.key) &&
                              settings.customInitial) ||
                            ([
                              'temperatureDistanceFactor',
                              'luminosityA',
                              'luminosityB',
                              'luminosityC',
                            ].includes(definition.key) &&
                              settings.legacyTemperature) ||
                            (definition.key === 'maxRestarts' && settings.unlimitedRestarts) ||
                            (definition.key === 'cageHardRadius' && !settings.cageHard) ||
                            (definition.key === 'cageExponent' && settings.cageHard)
                          }
                          min={definition.min!}
                          max={definition.max!}
                          step={definition.step!}
                          value={settings[definition.key]}
                          onChange={(value) =>
                            store.set(definition.key as NumericSettingKey, value)
                          }
                        />
                      );
                    if (definition.kind === 'boolean' && boolean(definition.key)) {
                      const key = definition.key;
                      return (
                        <div key={id}>
                          <label className="toggle-row" htmlFor={id}>
                            <span>{definition.label}</span>
                            <input
                              id={id}
                              type="checkbox"
                              checked={settings[key]}
                              onChange={(event) => store.set(key, event.target.checked)}
                            />
                          </label>
                          {definition.description && <small>{definition.description}</small>}
                        </div>
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
                  <>
                    <small className="current-seed">
                      当前运行 Seed：<code>{snapshot.seed}</code>
                    </small>
                    <small>
                      当前第 {snapshot.run.round} 轮 · 已自动重启 {snapshot.run.autoRestarts} 次（
                      {snapshot.run.seedMode === 'fixed' ? '固定' : '随机'}模式）
                    </small>
                    <button className="reset-button" onClick={onReset}>
                      应用尺度并重置
                    </button>
                    {settings.seedMode === 'fixed' && (
                      <>
                        <button className="reset-button" onClick={onRerun}>
                          重新运行当前 Seed
                        </button>
                        <small>
                          恢复本轮实际使用的尺度、质量与环境/初值设置，从第 0
                          年开始；新比赛计数清零。
                        </small>
                      </>
                    )}
                  </>
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
                    <small>
                      仅参考质量；不会使用现实中的层级轨道。行星半径为地球半径假设，质量由原版单位设置决定。
                    </small>
                  </>
                )}
                {category === '运行控制' && (
                  <button className="reset-button" onClick={onReset}>
                    ↻ 手动重置{' '}
                    <span>{settings.seedMode === 'random' ? '全新随机宇宙' : '重新开始比赛'}</span>
                  </button>
                )}
              </div>
            )}
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
