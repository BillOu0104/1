import { useCallback, useState, useSyncExternalStore } from 'react';
import type { SimulationRuntime } from '../simulation/SimulationRuntime';
import { ClockWidget } from './components/ClockWidget';
import { InformationPanels } from './components/InformationPanels';
import { SettingsPanel } from './components/SettingsPanel';
import { AudioVisualizer } from './components/AudioVisualizer';
import { SimulationScene } from './components/SimulationScene';
export function App({ runtime }: { runtime: SimulationRuntime }) {
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const settings = useSyncExternalStore(runtime.settings.subscribe, runtime.settings.getSnapshot);
  const [panelsVisible, setPanelsVisible] = useState(false),
    [settingsVisible, setSettingsVisible] = useState(false);
  const closeSettings = useCallback(() => {
    setSettingsVisible(false);
    window.setTimeout(() => document.getElementById('settings-button')?.focus(), 0);
  }, []);
  return (
    <main className="observatory">
      <SimulationScene runtime={runtime} />
      <div className="scene-vignette" aria-hidden="true" />
      <ClockWidget
        years={snapshot.years}
        expanded={panelsVisible}
        onToggle={() => setPanelsVisible((v) => !v)}
      />
      <InformationPanels snapshot={snapshot} visible={panelsVisible} settings={settings} />
      <div className="status-notice" role="status" aria-live="polite">
        {snapshot.phase === 'initializing' ? (
          <strong>正在初始化物理系统…</strong>
        ) : snapshot.phase === 'ended' ? (
          <>
            <strong>{snapshot.reason?.message}</strong>
            <span>
              {snapshot.restartLimitReached
                ? '已达到最大自动重置次数，本场已结束；结果已保留'
                : snapshot.autoRestartBlocked
                  ? '自动重启已保护性停止，请手动重置'
                  : settings.paused
                    ? '已暂停，重启倒计时冻结'
                    : settings.autoRestart
                      ? snapshot.waitingForInitial
                        ? '正在等待初始条件…'
                        : `下一轮将在 ${Math.ceil(snapshot.restartIn)} 秒后开始`
                      : '自动重启已关闭，请手动重置'}
            </span>
          </>
        ) : settings.paused ? (
          <strong>模拟已暂停</strong>
        ) : null}
      </div>
      <AudioVisualizer />
      {settingsVisible && (
        <SettingsPanel
          store={runtime.settings}
          snapshot={snapshot}
          onReset={runtime.reset}
          onRerun={runtime.rerunCurrentSeed}
          onClose={closeSettings}
        />
      )}
      <button
        id="settings-button"
        className="settings-button"
        title="模拟设置"
        aria-label="切换设置面板"
        aria-expanded={settingsVisible}
        aria-controls="settings-panel"
        onClick={() => setSettingsVisible((v) => !v)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          aria-hidden="true"
        >
          <path
            d="m9 3-.6 2.3-1.5.9-2.3-.6-3 5.2 1.7 1.7v1.8l-1.7 1.7 3 5.2 2.3-.6 1.5.9L9 24h6l.6-2.3 1.5-.9 2.3.6 3-5.2-1.7-1.7v-1.8l1.7-1.7-3-5.2-2.3.6-1.5-.9L15 3Z"
            transform="translate(1 -1) scale(.9)"
          />
          <circle cx="12" cy="11.5" r="3" />
        </svg>
      </button>
    </main>
  );
}
