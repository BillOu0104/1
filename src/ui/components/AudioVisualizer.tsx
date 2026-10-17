import type { AudioFrame } from '../../adapters/contracts';
export interface AudioVisualizerProps {
  frame?: AudioFrame;
  mode?: 'placeholder' | 'live';
}
/** V0.1 is an explicit static placeholder. No audio device access. */
export function AudioVisualizer({ mode = 'placeholder' }: AudioVisualizerProps) {
  return (
    <section className="audio-visualizer" aria-label="音乐波形占位窗口">
      <div className="waveform" aria-hidden="true">
        {Array.from({ length: 65 }, (_, i) => (
          <i
            key={i}
            style={{
              height: `${3 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.31)) * 22 * (1 - Math.abs(i - 32) / 40)}px`,
            }}
          />
        ))}
      </div>
      <span className="micro-label">
        AUDIO RESPONSE <b>·</b> {mode === 'placeholder' ? '静态占位 / 待开发' : '待接入'}
      </span>
    </section>
  );
}
