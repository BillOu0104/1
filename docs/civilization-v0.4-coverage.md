# V0.4 原版机制功能覆盖清单

参考 SYKM《三体实时演算》用户提供的工程，仅独立实现数学和机制，不分发原版脚本或素材。

研究资料恢复说明：用户所述 handoff ZIP 在本执行环境路径不存在。通过同一用户的“现有壁纸逆向”研究会话恢复了研究 Markdown 的 §1–§9.4 主体、后续研究记录及参数表；原始 Markdown 尾部未能完整恢复，**不声称读到了完整 ZIP 或完整 Markdown**。随后成功恢复用户此前上传的 `project.json` 和六段 `scene.7z`，解包并检查了完整 `scene.json` 中的 191 段脚本，直接核实以下全部机制。原始资料保存在仓库外 `/workspace/research-v04/`。没有用文档 §8 的设计建议替代实际算法。

核对哈希：project.json `982ef336280c59023731a34c6d64a49b4bf0a54c344ff62321410ccf5a31930d`；scene.json `8b7f86e27fa37007fe0d8ba10ae250f7594740f2e9ddef0ed588bf09592e9acc`。

| 原版证据                       | 已实现机制                                                               | V0.4 落点                                              | 自动验证                         |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------- |
| M `resetSystem` 924–1026       | 四体固定配置质量、12 位置后 12 速度调用、立方体分量均匀分布              | `OriginalRandomInitializer.generate`                   | `original-initializer.test.ts`   |
| P Random Pos / Speed Range     | L=2、V=.1；真实单位换算                                                  | `environment/config.ts`, `originalInitializer.ts`      | 分量/统计/单位测试               |
| M 965–995、P Custom Seed       | 24 个直接初值分量及默认值；不是整数 PRNG Seed                            | `customInitial`, `initial0X` 等设置、`customVector`    | 自定义向量与质量测试             |
| M 不筛选、不消漂移、不归一速度 | 取消旧分布、角动量/能量/寿命筛选                                         | `OriginalRandomInitializer`                            | 抽样顺序与质心漂移测试           |
| V0.3–V0.3.1 兼容要求           | Galaxy Scale、随机/固定 Seed、确定性轮次、自定义质量                     | Runtime / Worker                                       | 原有竞争/Worker 测试 + V0.4 测试 |
| T 43–110                       | 三星辐射叠加、κ、距离下限、动态反照率、σ、振荡、°C 限幅/两位小数、K 换算 | `radiationTemperature`, `readEnvironment`              | `environment.test.ts`            |
| T旧 15–28                      | 旧经验温度公式                                                           | `legacyTemperature` 选择                               | 旧公式对照测试                   |
| E 53–101                       | 巨日/双日/三日凌空，飞星/双飞星/三飞星，恒/乱纪元及边界                  | `astronomicalCounts`, `classifyEra`                    | 全状态和严格/包含边界测试        |
| 用户要求的纪元持续时间/防抖    | 有界已结束纪元、当前持续时间、普通纪元连续确认                           | `EraMachine`, `CivilizationSimulation`                 | 纪元转换与短脉冲测试             |
| C 209–247                      | 耐温适宜计数、ceil(n) 诞生、存活时继续累计                               | `CivilizationSimulation.observe`                       | 诞生/计数/暂停/多代测试          |
| C 217–395                      | 原版距离大撕裂→行星碰撞→恒星碰撞→温度毁灭，温度死亡天象附注              | `killIfHostile`                                        | 灾难优先级与原因测试             |
| C 218–395、397–535             | 编号、出生/死亡文明年与物理年、整数寿命、同次出生死亡、重复诞生          | `destroy`, `CivilizationRecord`                        | 整数寿命/原子双事件测试          |
| 076 15–40                      | [-50,70] 浸泡，之外脱水；不改变死亡耐受或年龄推进                        | `monitor`, `CivilizationStatus`                        | 脱水/复苏/无免疫测试             |
| Y 15–40                        | Kt 平方倍率                                                              | 连续 `civilYear`，独立物理年                           | 时间因子连续/无物理时间改写测试  |
| C 397–535                      | 最近五条、dt 摘要间隔、死亡寿命前六名、附注、长年份格式                  | `log`, `top`, `CivilizationPanels`, `formatCivilYears` | 有界记录/排序/即时事件测试       |
| Q 104                          | Kt/牢笼/κ/默认参数真实性字母                                             | `annotation`、`authenticity`                           | 附注对照测试                     |
| P Civ Status / Rank、Cnen2     | 显隐和文明信息中英文                                                     | `CivilizationPanels`, `labels.ts`                      | UI/E2E                           |
| P Civ Log / Rank 布局与透明度  | x/y/size，状态/寿命/5 事件透明度，排行标题/6 行透明度                    | `V04_RULES`, `localLayout`                             | 注册/持久化/UI 测试              |
| 用户要求生命周期               | 不同宇宙隔离；会话榜单独保留；真实物理结束关闭文明                       | Engine `start/end`, `terminate`                        | 重启/人工重置/物理结束测试       |
| 原版未实现的功能               | 无人口、科技、发展随机数、热惯性、脱水免疫、联网排名                     | 明确不虚构；年龄增长即原版“发展”                       | 文档范围说明                     |

## 不机械复制的缺陷与平台依赖

- 两温度脚本均写共享变量，Wallpaper Engine 回调顺序未知：显式选择一种，默认辐射。
- 原版帧计数与墙钟振荡：使用物理模拟时间；固定每物理年 60 次虚拟文明回调，Kt 仅平方影响文明纪年。
- 原版 `d12/d13/d23` 缺生产者：用真实恒星间距修复意图中的文明碰撞规则。
- 同次出生死亡日志编号错误：按同一文明编号写两条事件。
- 原版重启信号竞争与历史不归零：由物理事件直接通知并划分宇宙。
- 原版边界允许 L=0、零质量：本项目为保留物理引擎有效性，L 最小 .001、行星质量最小 .001 原版单位，并有至多 64 次“仅真实体积重叠”重抽样。自定义重叠直接报错。
- 原版力软化、Yoshida 和距离逃逸未移植：用户明确保留当前 DOPRI5、真实物理碰撞/潮汐/逃逸及现有牢笼。
- 原版布局是世界坐标：适配为原有信息面板内部有界排版，保留整体布局。
