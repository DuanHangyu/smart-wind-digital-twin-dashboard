# A. 自定义区域地图：建模前多视图分析与生产基线

> 状态：建模前分析已冻结  
> 资产代号：`A_CUSTOM_MAP`  
> 目标：浏览器 Three.js / WebGL，桌面与移动端实时交互  
> 一级证据：视频原始地图帧、项目三维建模规范  
> 二级证据：ImageGen A01 六视角与 A02 结构拆分图

## 1. 参考图

![视频范围标注](../../../analysis/modeling/reference/01-map-model-scope.jpg)

![A01 六视角](../../../analysis/modeling/ai_reference_turnarounds/A_map/A01-map-six-view-turnaround.png)

![A02 结构拆分](../../../analysis/modeling/ai_reference_turnarounds/A_map/A02-map-geometry-breakdown.png)

## 2. 整体比例

| 项目 | 冻结值 | 说明 |
|---|---:|---|
| 模型宽度 X | 12.0 m | 浏览器模型坐标基线，不代表真实地理尺寸 |
| 模型高度 Y | 约 7.8 m | 轮廓宽高比约 1.54:1 |
| 向下挤出 Z | 0.48 m | 约为宽度的 4%，足以在低俯角显示侧壁 |
| 分区间隙 | 0.035–0.055 m | 只用于突出边界，避免形成明显断裂 |
| 顶面倒角 | 高模 0.055 m；低模 0.025 m | 低模仅保留一段倒角 |
| 原点 | 地图包围盒中心，底面 Z=0 | 便于自动居中和统一缩放 |

比例判读：视频默认镜头是斜俯视，透视会放大前侧厚度；不能直接把画面中的侧壁像素高度当成真实挤出比例。最终采用“宽 12、厚 0.48”的稳定基线。

## 3. 主要结构

```text
A_CUSTOM_MAP_ROOT
├── PART__MAP_BASE（可选底层承托）
├── PART__REGION_01
├── PART__REGION_02
├── ...
├── PART__REGION_14
├── HOTSPOT__REGION_01
├── HOTSPOT__REGION_02
└── ... HOTSPOT__REGION_14
```

每个 `PART__REGION_*` 是闭合挤出体，包含：

- 顶面：共用一套全局平面 UV 和 PBR 顶面材质。
- 侧壁与底面：使用深青色侧壁材质。
- 自定义属性：区域编号、显示名称、交互标志和对应热点名。
- 独立原点：位于自身平面质心，便于选中、高亮和轻微抬升。

## 4. 对称关系

- 地图外轮廓在 XY 平面内完全不对称，不使用 Mirror。
- 14 个内部区域也不镜像复制，每个区域都是独立形状。
- 唯一可复用的对称关系是 Z 方向统一挤出深度、统一倒角规则和统一材质结构。
- 所有热点沿各区域质心生成，热点本身不参与渲染。

## 5. 材质分区

| 材质 | 节点/面 | PBR 内容 | 运行时处理 |
|---|---|---|---|
| `MAT__MAP_TOP` | 区域顶面 | Base Color、Normal、AO、Roughness、Metallic | 可增加轻微 emissive、扫描线与点阵 |
| `MAT__MAP_SIDE` | 侧壁和底面 | 深青 Base Color、较高 Roughness、低 Metallic | 运行时可加垂直渐变和边缘发光 |
| `MAT__MAP_SELECTED` | 不单独导出 | — | Three.js 通过克隆材质和 emissive 高亮实现 |

PBR 色彩基线：

- 顶面主色：`#139A96`–`#35C6BE`。
- 侧壁主色：`#063D42`–`#0A6164`。
- 金属度：顶面约 0.12，侧壁约 0.20。
- 粗糙度：顶面约 0.48，侧壁约 0.62。
- AO：主要强调分区间隙、倒角与边界微结构。

## 6. 可独立操作部件

| 节点规则 | 数量 | 操作 |
|---|---:|---|
| `PART__REGION_*` | 14 | 点击、悬停、高亮、抬升、复位 |
| `HOTSPOT__REGION_*` | 14 | HTML 标签锚点、射线选择辅助、数据绑定 |
| `A_CUSTOM_MAP_ROOT` | 1 | 自动居中、缩放、整体旋转 |

地图边界线、点阵、环形轨道、粒子和向下光幕不作为 Blender 模型部件；这些效果由 Three.js 运行时生成。

## 7. 高模与低模策略

### 高模

- 分区顶边使用 3–4 段倒角。
- 增加细窄边界凸条和规则点阵微结构，作为 Normal/AO 烘焙源。
- 不增加无意义的底部细节。

### 网页低模

- 保留轮廓折点和一段倒角。
- 14 个区域保持独立，避免为了减少 Draw Call 合并后失去交互能力。
- 顶面细节通过 Normal/Base Color 表达，不保留点阵微几何。
- 目标总三角面：小于 12,000；目标 Draw Call：不高于 18。

## 8. UV 与贴图

- 顶面使用全局平面投影，所有区域共享同一 0–1 地图坐标。
- 侧壁/底面使用第二材质，不依赖顶面纹理细节。
- 贴图基准尺寸 1024×1024；移动端可降至 512×512。
- Base Color 使用 ETC1S；Normal、AO、Roughness、Metallic/ORM 使用 UASTC 或无损通道策略。
- 独立交付 Base Color、Normal、AO、Roughness、Metallic PNG，同时输出 KTX2。

## 9. 坐标、命名与导出

- Blender：Z 轴向上；导出 glTF 后由导出器转换为 Y 轴向上。
- 根节点原点：地图中心，底面在 Z=0。
- 模型单位：米。
- 自定义属性作为 glTF extras 导出。
- GLB 必须保留 `PART__*` 和 `HOTSPOT__*` 节点名称。

## 10. 阶段版本

| 阶段 | 文件 | 验收重点 |
|---|---|---|
| 结构拆解 | `A01_structure_breakdown.blend` | 14 个区域、层级、热点规划 |
| 基础形体 | `A02_base_shape.blend` | 外轮廓、分区闭合、统一厚度 |
| 形体精修 | `A03_shape_refined.blend` | 间隙、质心、倒角、法线 |
| 高模细节 | `A04_highpoly_detail.blend` | 边界凸条、点阵微结构 |
| 低模拓扑 | `A05_lowpoly_retopology.blend` | 面数、轮廓、移动端预算 |
| UV 展开 | `A06_uv_unwrapped.blend` | UV 存在、无越界、全局对齐 |
| PBR 烘焙 | `A07_baked_pbr.blend` | Normal/AO 烘焙、五类 PBR 贴图 |
| 导出就绪 | `A08_export_ready.blend` | PART/HOTSPOT、extras、GLB 导出 |

## 11. 冻结结论

本资产采用一套 14 分区自定义轮廓，不使用真实地图数据。建模核心是“独立闭合区域 + 统一向下挤出 + 全局 UV + PBR 顶面 + 运行时全息效果”。视频级还原所需的点阵、边缘光、扫描和粒子均留在 Three.js 层实现。

