import { useEffect, useState } from 'react';
export function ClockWidget({
  years,
  expanded,
  onToggle,
}: {
  years: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <button
      className="clock-widget"
      onClick={onToggle}
      aria-label="切换左右信息面板"
      aria-expanded={expanded}
      aria-controls="information-panels"
    >
      <span className="eyebrow">THREE BODY / OBSERVATORY</span>
      <time className="clock" dateTime={now.toISOString()}>
        {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}
      </time>
      <span className="clock-meta">
        <span>
          {now.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })}
        </span>
        <i />
        <span>
          模拟纪年 <strong>{years.toFixed(3)}</strong> YR
        </span>
      </span>
      <span className="clock-hint">
        {expanded ? '收起观测数据' : '点击展开观测数据'}{' '}
        <span aria-hidden="true">{expanded ? '−' : '+'}</span>
      </span>
    </button>
  );
}
