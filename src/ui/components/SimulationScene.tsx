import { useEffect, useRef, useState } from 'react';
import { SceneRenderer } from '../../rendering/SceneRenderer';
import type { SimulationRuntime } from '../../simulation/SimulationRuntime';
export function SimulationScene({ runtime }: { runtime: SimulationRuntime }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!container.current) return;
    let renderer: SceneRenderer | undefined, detach: (() => void) | undefined;
    try {
      renderer = new SceneRenderer(container.current, (message) => {
        detach?.();
        setError(message);
      });
      detach = runtime.attach(renderer);
      setLoading(false);
    } catch {
      renderer?.dispose();
      setLoading(false);
      setError('无法启动 WebGL。请使用支持 WebGL 的浏览器，并检查硬件加速设置。');
    }
    return () => {
      detach?.();
      renderer?.dispose();
    };
  }, [runtime, attempt]);
  return (
    <>
      <div ref={container} className="scene-container" />
      {loading && !error && (
        <div className="scene-loading" role="status">
          INITIALIZING GRAVITY FIELD · 正在初始化
        </div>
      )}
      {error && (
        <div className="scene-error" role="alert">
          <span className="eyebrow">RENDERING UNAVAILABLE</span>
          <h2>三维画面暂不可用</h2>
          <p>{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              setAttempt((v) => v + 1);
            }}
          >
            重试渲染
          </button>
        </div>
      )}
    </>
  );
}
