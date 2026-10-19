const labels: Record<string, readonly [string, string]> = {
  'configuration-change': ['参数修改', 'Configuration Changed'],
  stable: ['恒纪元', 'Stable Era'],
  chaotic: ['乱纪元', 'Chaotic Era'],
  sun1: ['巨日凌空', 'Giant Sun'],
  sun2: ['双日凌空', 'Dual Suns'],
  sun3: ['三日凌空', 'Tri-Solar Day'],
  flying1: ['飞星', 'Flying Star'],
  flying2: ['双飞星', 'Double Flying Stars'],
  flying3: ['三飞星', 'Triple Flying Stars'],
  birth: ['文明诞生', 'Civilization Born'],
  death: ['文明毁灭', 'Civilization Ended'],
  dehydration: ['脱水', 'Dehydrated'],
  rehydration: ['浸泡 / 复苏', 'Rehydrated'],
  'extreme-hot': ['极端高温', 'Extreme Heat'],
  'extreme-cold': ['极端低温', 'Extreme Cold'],
  status: ['文明状态摘要', 'Civilization Status'],
  'universe-start': ['新宇宙开始', 'Universe Started'],
  'universe-end': ['本轮宇宙结束', 'Universe Ended'],
  'civil-roche': ['大撕裂（文明距离阈值）', 'Civil Roche Distance'],
  'civil-planet-collision': ['行星相撞（文明阈值）', 'Civil Planet Collision'],
  'civil-star-collision': ['恒星相撞（文明阈值）', 'Civil Stellar Collision'],
  hot: ['高温', 'Heat'],
  cold: ['低温', 'Cold'],
  'physical-collision': ['天体真实碰撞', 'Physical Collision'],
  'physical-tidal': ['行星潮汐撕裂', 'Physical Tidal Disruption'],
  'physical-escape': ['天体逃逸', 'Physical Escape'],
  'physical-numerical': ['物理数值异常', 'Numerical Failure'],
  'physical-manual': ['手动重置', 'Manual Reset'],
};
export function environmentLabel(type: string, english = false): string {
  if (type.startsWith('era:'))
    return `${english ? 'Era: ' : '纪元切换：'}${environmentLabel(type.slice(4), english)}`;
  return labels[type]?.[english ? 1 : 0] ?? type;
}
export function eventDetail(detail: string | undefined, english = false): string {
  if (!detail) return '';
  return detail
    .split(': ')
    .map((s) => environmentLabel(s, english))
    .join(' · ');
}
export function formatCivilYears(year: number): string {
  return year >= 1e8 ? year.toExponential(2) : year.toFixed(0);
}
