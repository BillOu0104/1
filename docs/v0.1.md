# 三体实时模拟壁纸 · V0.1

一个可在桌面浏览器运行的三维牛顿引力模拟。三颗恒星和一颗有质量的行星均参与相互引力计算，没有预设运动动画或锁定轨道。React 只负责透明 UI，物理核心不依赖浏览器、React 或 Three.js。

## 直接在浏览器使用（GitHub Pages）

启用 Pages 并合并 PR #1 后，预期访问地址为 **[https://billou0104.github.io/1/](https://billou0104.github.io/1/)**，实际地址以工作流部署结果或 Settings → Pages 为准。首次部署完成前，该地址可能返回 404。使用网页无需在本机安装 Node.js 或运行程序。

仓库管理员只需在 GitHub 网页上操作：

1. 打开仓库 **Settings → Pages → Build and deployment**，将 **Source** 选为 **GitHub Actions**。本仓库当前为私有；私有仓库使用 Pages 需要支持此功能的套餐（个人账号通常为 GitHub Pro）。如果页面提示升级，可升级套餐或按自己的公开需求将仓库改为 public。
2. 合并 **[PR #1](https://github.com/BillOu0104/1/pull/1)** 到 `main`。如设置页要求先存在工作流，可先合并，再选择 Source。
3. 在 **Actions → Deploy GitHub Pages** 等待构建和部署成功；完成后点击部署任务的站点链接。若先合并后才启用 Pages，选择 **Run workflow → Branch: main → Run workflow**，或重新运行失败的部署。
4. 之后每次 `main` 更新都会自动测试、构建并重新发布。普通 PR 不部署；手动运行同样只允许 `main`。

Pages 工作流使用官方 `configure-pages`、`upload-pages-artifact`、`deploy-pages` Actions 和内置 `GITHUB_TOKEN` / OIDC，不需要手工创建 PAT、上传 `dist/`、创建 `gh-pages` 分支或选择“Deploy from a branch”。如果 `github-pages` 环境设置了人工审批，需在 Actions 中批准该环境的部署；默认无此额外操作。普通 Pages 站点通常公开访问，即使源码仓库为私有。

## 本地开发（可选）

需要 **Node.js 22.12+** 和 npm。Windows、macOS、Linux 命令相同：

```bash
npm ci
npm run dev
```

打开终端显示的地址。生产构建及本地预览：

```bash
npm run typecheck
npm test
npm run build
npm run preview
```

`dist/` 为静态网页产物。默认构建使用相对资源路径，适合本地预览和后续壁纸打包；Pages 工作流通过 `VITE_BASE_PATH` 使用 GitHub 返回的真实站点路径（当前项目站点为 `/1/`；用户站点或根目录自定义域名为 `/`）。生产包需要通过 HTTP 服务访问。没有安装或连接 Wallpaper Engine。

浏览器测试：

```bash
npx playwright install chromium
npm run build
npm run test:e2e
```

已有系统 Chromium 时，在 Linux/macOS 可执行：

```bash
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Windows PowerShell 可用 `$env:CHROMIUM_PATH="C:\path\to\chrome.exe"`，然后执行 `npm run test:e2e`。浏览器测试使用本地生产预览服务，包含 2520×1080（21:9）、1920×1080（16:9）与 640×800；截图在忽略的 `test-results/` 中。CI 安装测试专用 Chromium，不更改应用宿主系统设置。

PR CI 使用仓库子路径进行生产构建和浏览器测试，验证 Pages 的 JavaScript、CSS 和分包可以正常加载。在 Linux/macOS 本地复现该路径（预览时也需传入相同的 `VITE_BASE_PATH`）：

```bash
VITE_BASE_PATH=/1/ npm run build
VITE_BASE_PATH=/1/ PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173/1/ npm run test:e2e
```

## 使用

- 全屏 3D 背景：拖动旋转，滚轮缩放；镜头目标自动跟随恒星质心。
- 顶部时钟取浏览器所在系统的真实本地时间；模拟纪年仅取物理时间，两者独立。
- 点击时钟同时显示/隐藏左右信息面板；初始隐藏，不影响模拟。
- 右下角齿轮打开设置；支持暂停、0.1–20× 速度、自动重启、轨迹、Seed 和手动重置。`Escape` 关闭设置。
- Seed 输入需点击“应用并重置”；手动重置使用已保存 Seed。当前运行 Seed 单独显示，便于复现自动重启后的一轮。
- 自动重启默认开启。结束时显示原因，至少提示 2 秒；自动重启之间至少隔 8 秒。30 秒内自动重启三次后，再次结束会停止自动重启，需手动重置解除保护。
- 暂停会冻结物理时间和重启倒计时；页面隐藏时停止 RAF，不积累补算时间。
- 设置保存在 `localStorage` 的 `three-body:settings:v1`；存储拒绝或满额时仍可在内存中使用。

## 已实现

- 三维双向牛顿引力、Velocity Verlet、固定步长、软化保护、积分器替换接口。
- Seed 可复现的 Random 生成器：分离恒星角位置、去除质心漂移、限制初始动能；行星在一颗恒星附近取得初始轨道速度。
- 碰撞（包括一步内穿越）、持续逃逸证据、非有限数值及积分异常检测。
- 自动/手动重置、事件历史（最多 60 条）、当前 Seed、累计重启次数、能量和步数遥测。
- 程序化星空、三色恒星、行星、有限长度轨迹、OrbitControls、窗口缩放、WebGL 错误与重试界面。
- 21:9 主布局、16:9 和窄窗口 CSS；可滚动信息与设置面板。
- 类型化 Settings Registry、默认值提供器、独立持久化接口、Feature Registry、类型化事件总线。
- 物理单元、生命周期、状态、组件、调度器及真实浏览器交互测试。

## 扩展契约与未实现项

| 模块                         | V0.1 状态与接口                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Quick Settings               | 速度可用；语言、主题、背景切换仅配置契约                                                                   |
| Physics                      | Verlet 可用；`Integrator` 可替换；Yoshida4、参数编辑和约束未实现                                           |
| Initial Conditions           | `InitialConditionGenerator` + Random 可用；LongLived / StructuredRandom 仅模式声明，无筛选或预模拟         |
| Camera                       | 旋转、缩放、跟随可用；高级参数仅配置契约                                                                   |
| Orbit Appearance             | 轨迹开关可用；颜色、半径、发光编辑未实现                                                                   |
| Background                   | 程序化星空可用；星云与自定义背景未实现                                                                     |
| Dust / Post Processing       | 类型契约，无尘埃、HDR、模糊、Bloom                                                                         |
| Temperature                  | `TemperatureEstimate`；无温度或宜居性模型                                                                  |
| Civilization / Log / Ranking | `CivilizationState`；无文明模拟、虚构数据或排行                                                            |
| Clock / UI                   | 时钟、透明浮层、双侧面板可用；自定义布局未实现                                                             |
| Audio Response               | `AudioVisualizerProps`、`AudioFrame`、`AudioSourceAdapter`；只有明确标注的静态波形，不访问麦克风或系统音频 |
| Event Notifications          | 应用内结束提示可用；`NotificationHostAdapter` 预留桌面通知，未请求浏览器通知权限                           |
| Wallpaper Integration        | `WallpaperHostAdapter` 属性/生命周期契约，`runtime.setHostPaused()`；无全局 WE 监听器或 Windows 通知假设   |
| Loading / Restart UI         | 画面启动、渲染错误重试、结束提示和重启保护可用；复杂过渡动画未实现                                         |

没有使用外部版权图片、模型、原壁纸源码或音频。

## 物理单位与数值取舍

归一化采用 **G = 1**，距离单位 **AU**，质量单位 **太阳质量 M☉**。时间单位
`T₀ = sqrt(AU³ / (G_phys × M☉)) ≈ 58.13 天`，因此：

```text
模拟年份 = 累计物理时间 / (2π)
1× 速度 = 每现实秒推进 0.6 T₀ ≈ 0.09549 模拟年
固定 dt = 0.002 T₀ ≈ 0.1163 天
```

引力使用 Plummer 软化：`aᵢ = Σ G mⱼ (rⱼ-rᵢ) / (|rⱼ-rᵢ|²+ε²)^(3/2)`，默认 `ε = 0.008 AU`。能量诊断使用与此一致的软化势能。恒星碰撞半径为 `0.065 AU`，行星为 `0.018 AU`，用于数值演示，**并非真实太阳/地球尺度**；屏幕显示半径另行放大以保证可读性。恒星质量随机为 `0.7–1.5 M☉`，行星质量 `3×10⁻⁶ M☉`。

逃逸相对其余天体的质心和质心速度判断，同时要求超过 100 AU、向外运动、相对轨道比能量为正，并持续至少 1 T₀。它是适合 V0.1 的保守启发式，并非混沌四体问题的严格永久逃逸证明。

每渲染帧最多 256 个物理步，输入现实时间最多取 0.25 秒；过载时丢弃无法处理的模拟时间并公开记录，优先避免浏览器卡死。高倍速在低性能设备上可能无法达到请求速度。真实时钟始终不受此限制。

固定步长辛积分器不能保证任意混沌系统永远保持小能量误差，特别是极近距离遭遇。软化、碰撞终止和数值保护限制风险；面板公开能量偏差。Random 不保证长期稳定，允许系统解体。未来可以在不改变核心调用方的情况下替换积分器和生成器。

## 工程结构

```text
src/
  physics/       纯 TS：天体、向量、引力、Verlet、Seed、生成器、终止检测
  simulation/    引擎状态机与浏览器调度器（分别独立）
  rendering/     Three.js Renderer、轨迹环形缓冲、镜头与资源释放
  settings/      配置类型、Registry、默认值、Store、Persistence
  events/        类型化事件总线
  features/      16 类模块描述、注册、启用与清理
  adapters/      Wallpaper / Notification / Audio / Civilization / Temperature 契约
  ui/            React 组件与响应式透明 UI
```

详细的数据流、扩展方式和生命周期见 [架构文档](docs/architecture.md)。截图与运行验证见 [验证记录](docs/validation.md)。
