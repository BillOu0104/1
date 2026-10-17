import type { EventBus, AppEvents } from '../events/EventBus';
import type { SettingsStore } from '../settings/SettingsStore';
export type FeatureId =
  | 'quick'
  | 'physics'
  | 'initial'
  | 'camera'
  | 'orbit'
  | 'background'
  | 'dust'
  | 'postProcessing'
  | 'temperature'
  | 'civilization'
  | 'civilizationLog'
  | 'widgets'
  | 'audio'
  | 'notifications'
  | 'wallpaper'
  | 'loading';
export interface FeatureContext {
  settings: SettingsStore;
  events: EventBus<AppEvents>;
}
export interface FeatureModule {
  id: FeatureId;
  label: string;
  status: 'implemented' | 'partial' | 'planned';
  description: string;
  activate?: (context: FeatureContext) => void | (() => void);
}
/** Registration does not imply activation. A module returns its own cleanup function. */
export class FeatureRegistry {
  private modules = new Map<FeatureId, FeatureModule>();
  private active = new Map<FeatureId, () => void>();
  register(module: FeatureModule): this {
    if (this.modules.has(module.id)) throw new Error(`Duplicate feature: ${module.id}`);
    this.modules.set(module.id, module);
    return this;
  }
  list(): FeatureModule[] {
    return [...this.modules.values()];
  }
  enable(id: FeatureId, context: FeatureContext): void {
    const module = this.modules.get(id);
    if (!module || module.status === 'planned') throw new Error(`Feature unavailable: ${id}`);
    if (!this.active.has(id)) this.active.set(id, module.activate?.(context) ?? (() => {}));
  }
  disable(id: FeatureId): void {
    this.active.get(id)?.();
    this.active.delete(id);
  }
  dispose(): void {
    for (const id of this.active.keys()) this.disable(id);
  }
}
export const features = new FeatureRegistry();
const definitions: FeatureModule[] = [
  {
    id: 'quick',
    label: '快捷设置',
    status: 'partial',
    description: '已支持速度；语言与主题待开发',
  },
  {
    id: 'physics',
    label: '物理引擎',
    status: 'partial',
    description: '自适应 DOPRI5、Verlet、守恒诊断、潮汐判据与 Worker 已启用',
  },
  {
    id: 'initial',
    label: '初始条件',
    status: 'partial',
    description: 'Random + Seed 已启用；高级生成与预筛选暂时停用',
  },
  {
    id: 'camera',
    label: '镜头控制',
    status: 'partial',
    description: '拖动、缩放与中心跟随已启用；高级设置待开发',
  },
  {
    id: 'orbit',
    label: '轨道外观',
    status: 'partial',
    description: '轨迹开关已启用；颜色与发光编辑待开发',
  },
  {
    id: 'background',
    label: '宇宙背景',
    status: 'partial',
    description: '程序化星空已启用；星云与自定义背景待开发',
  },
  { id: 'dust', label: '尘埃粒子', status: 'planned', description: '待开发' },
  { id: 'postProcessing', label: '后期处理', status: 'planned', description: '待开发' },
  {
    id: 'temperature',
    label: '温度与宜居性',
    status: 'planned',
    description: '待开发 · 无温度估算数据',
  },
  { id: 'civilization', label: '文明演化', status: 'planned', description: '待开发 · 无文明模型' },
  { id: 'civilizationLog', label: '文明日志与排行', status: 'planned', description: '待开发' },
  {
    id: 'widgets',
    label: '时钟与界面',
    status: 'partial',
    description: '系统时钟与双侧信息面板已启用；布局编辑待开发',
  },
  { id: 'audio', label: '音频响应', status: 'planned', description: '待开发 · 当前仅静态波形占位' },
  {
    id: 'notifications',
    label: '事件通知',
    status: 'partial',
    description: '应用内通知已启用；桌面通知需独立宿主适配器',
  },
  {
    id: 'wallpaper',
    label: 'Wallpaper Engine',
    status: 'planned',
    description: '待开发 · 已预留属性与生命周期适配器',
  },
  {
    id: 'loading',
    label: '加载与重启',
    status: 'implemented',
    description: '启动、结束提示、重启冷却与熔断保护',
  },
];
definitions.forEach((module) => features.register(module));
