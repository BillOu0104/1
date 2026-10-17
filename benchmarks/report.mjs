import { readFileSync, writeFileSync } from 'node:fs';
const r = JSON.parse(readFileSync('docs/benchmarks/results.json', 'utf8'));
const b = JSON.parse(readFileSync('docs/benchmarks/browser.json', 'utf8'));
const n = (x) => Number(x).toFixed(2),
  e = (x) => Number(x).toExponential(2),
  pct = (x) => (x * 100).toFixed(1) + '%';
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const raw = r.populations['raw-v02'].summary,
  screen = r.populations['screened-v02'].summary;
const alive = (s) => Math.round(s.survivedHorizon * r.count);
const relation =
  screen.survivedHorizon < raw.survivedHorizon
    ? '低于'
    : screen.survivedHorizon > raw.survivedHorizon
      ? '高于'
      : '等于';
let text = `# V0.2 可重复基准\n\n本记录由 \`npm run benchmark:report\` 从 [数值原始数据](results.json) 与 [浏览器原始数据](browser.json) 生成。\n\n## 方法\n\n冻结 V0.1 提交 \`${r.baselineCommit}\`，原始源码保存在 \`benchmarks/baseline/\`。数值环境：${r.node} / ${r.platform} / ${r.cpu}。固定 Seed 为 \`benchmark-v2-0\` 至 \`benchmark-v2-${r.count - 1}\`，所有种群使用相同 Seed 列表，但生成策略不同，不是相同初始位置。\n\n内核实验使用前6个 Structured Chaos 原始初值、完全相同的质量/力律/软化，积分5年，只比较积分器，不做预筛选、碰撞/潮汐终止或 Worker 调度。预热一次后计时3次，报告累计内核时间的中位数及范围（包含每步计时开销，不含诊断开销）；每10接受步采样守恒误差，因此是采样最大值，并非严格误差上界。\n\n| 方案 | 内核ms（3次中位数） | 范围ms | 接受步 | 最大采样能量相对误差 | 角动量相对误差 |\n| --- | ---: | --- | ---: | ---: | ---: |\n`;
for (const a of r.algorithms)
  text += `| ${a.name} | ${n(a.cpuMs)} | ${a.cpuMsRange.map(n).join('–')} | ${a.steps} | ${e(a.maxEnergy)} | ${e(a.maxAngular)} |\n`;
text += `\n**默认选择 DOPRI5 rtol=1e-9，而非最高步数配置。** 缓存 Verlet 保持旧精度并显著降低成本；单纯将步长缩小10倍成本更高。Yoshida4 在平滑轨道能量上改善，但固定步长难以覆盖任意近掠，负内部步也不宜直接判定碰撞。1e-9相比1e-7增加一定成本，换来约两个数量级的能量误差改善；1e-11成本约翻倍，没有作为默认。辛方法的角动量保存更好，不能声称 DOPRI5 的所有守恒量都胜出；默认容差下观察误差仍很小。\n\n## 系统存活与复杂性\n\n每组${r.count} Seed、每轮观测至${r.horizonYears}年或首次结束，关闭自动重启。\`censored\` 表示活到观察窗末，不是已知永久寿命；分位数按${r.horizonYears}年截尾，达到该值应理解为至少该年限。每0.05现实秒/20×输入观察一次，采用各版本真实步数上限，采样时刻略不同。以下CPU包含实际引擎诊断及终止检测，不含渲染；预筛选CPU单列，不能隐去启动成本。\n\n| 方案 | 5年内结束 | 活到${r.horizonYears}年 | 观测时长 min / p25 / median / p75（年） | 交会中位数 | 邻居交换中位数 | 前台物理ms | 筛选ms |\n| --- | --- | --- | --- | ---: | ---: | ---: | ---: |\n`;
for (const [name, p] of Object.entries(r.populations)) {
  const s = p.summary;
  const survival = s.survivalYears;
  text += `| ${name} | ${pct(s.earlyEndsWithin5Years)} | ${pct(s.survivedHorizon)} | ${[survival.min, survival.p25, survival.median, survival.p75].map((x) => (x >= r.horizonYears ? '≥' + r.horizonYears : n(x))).join(' / ')} | ${s.medianEncounters} | ${s.medianExchanges} | ${n(s.cpuMs)} | ${n(s.screenMs)} |\n`;
}
text +=
  '\n| 方案 | 最大采样能量相对误差 | 角动量误差 | 动量误差 | 结束原因计数 |\n| --- | ---: | ---: | ---: | --- |\n';
for (const [name, p] of Object.entries(r.populations)) {
  const s = p.summary;
  text += `| ${name} | ${e(s.maxEnergyError)} | ${e(s.maxAngularError)} | ${e(s.maxMomentumError)} | ${Object.entries(
    s.reasons,
  )
    .map(([key, v]) => key + ': ' + v)
    .join(', ')} |\n`;
}
text += `\n交会采用恒星对距离进入1AU计一次、离开1.3AU才重新布防；最近邻恒星身份变化作为轨道交换代理，不能等同于拓扑轨道分类或 Lyapunov 混沌证明。观察越久自然可能记录更多交会，种群存活差异也影响此指标。\n\n**未改进项与偏差：** 筛选组${r.horizonYears}年存活比例${relation}未经筛选的V0.2组（${alive(screen)}/${r.count}对${alive(raw)}/${r.count}）；筛选偏好交互复杂、更多交换，并非最长寿命。筛选组${Math.round(screen.earlyEndsWithin5Years * r.count)}/${r.count}在前5年结束，较低的早期结束比例部分来自5年筛选窗，本来就存在选择偏差，绝不是零失败率保证。V0.1还有大得多的演示碰撞半径/软化，种群结果不能单独证明积分器提升，因此另列同初值同力律的内核实验。V0.2因真实半径更小，行星也可能先潮汐撕裂而非碰撞。原始/筛选V0.2分别观察到${raw.reasons.tidal ?? 0}/${screen.reasons.tidal ?? 0}次潮汐结束，未人为增强引力。有限样本只支持当前取舍，不证明无限稳定。\n\n## 浏览器实测\n\n${b.browserVersion ?? b.browser}，${b.renderer}，2520×1080。固定 \`browser-benchmark\` Seed，分别1×和20×；两版均实际构建、独立存储，开始推进后等待1.5秒，每次测6秒，3轮交替版本顺序。以下为3轮中位数。CDP TaskDuration只计主线程，**不等于整个浏览器CPU**；Worker前台积分任务CPU与首次筛选CPU单列，前台Worker列不包含后续预筛选。JS堆指标也只计主上下文。软件WebGL与实机GPU不可直接类比。\n\n| 版本 / 倍速 | 主线程任务ms/6秒 | RAF p50 / p95 ms | Worker任务 p95 ms | 前台Worker累计ms | 首次筛选CPUms | 长任务数 |\n| --- | ---: | --- | ---: | ---: | ---: | ---: |\n`;
for (const version of ['v01', 'v02'])
  for (const speed of [1, 20]) {
    const rows = b.rows.filter((row) => row.version === version && row.speed === speed);
    const m = (key) => median(rows.map((row) => row[key]));
    text += `| ${version} / ${speed}× | ${n(m('mainTaskMs'))} | ${n(m('rafP50Ms'))} / ${n(m('rafP95Ms'))} | ${n(m('workerCpuP95Ms'))} | ${n(m('workerCpuSumMs'))} | ${n(m('firstScreenCpuMs'))} | ${m('longTasks')} |\n`;
  }
text += `\nRAF仅表示浏览器回调可用性，不是应用实际GPU绘制次数。V0.2默认绘制30FPS、交互60FPS、高负载20FPS；静止画面跳过绘制。不能将单次RAF改善等同于稳定60FPS，也不能宣称从主线程转移出去的计算消失了。CPU时间会随硬件/JIT/软件渲染负载波动，原始逐轮样本全部保留，未做Windows/macOS实机测量。\n\n## 可靠性验证与复现\n\n\`npm test\`覆盖椭圆近掠、自适应拒步无副作用、守恒、张量旋转/叠加/Roche密度缩放、单步尖峰抑制、真实潮汐终止及预备初值重启、不同分片预算筛选复现、有限降级、Worker主线程隔离/请求背压/隐藏冻结/故障恢复与熔断、质量设置和旧版交互。\n\n\`npm run benchmark\` 重跑数值实验；\`CHROMIUM_PATH=/usr/bin/chromium npm run benchmark:browser\` 重跑浏览器（Linux云环境，需要tar和基线Git历史）；\`npm run benchmark:report\` 刷新本文。全量JSON包含每个Seed的观察时长、原因、误差和耗时。CI用6 Seed / 8年快速样本输出到测试artifact，不覆盖提交的完整24 Seed报告。\n`;
writeFileSync('docs/benchmarks/README.md', text);
