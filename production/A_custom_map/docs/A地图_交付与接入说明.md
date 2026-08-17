# A 自定义区域地图：建模、资产与 Three.js 交付说明

版本：1.0.0  
资产编号：`A_CUSTOM_MAP`  
坐标单位：米  
Blender：5.2 LTS  
网页运行时：Three.js 0.185.1

---

## 1. 交付结论

“A. 自定义区域地图”已从建模前分析推进到可运行网页资产。地图不是任何真实行政区，而是依据参考视频的轮廓语言设计的原创区域：东西向约 12 m、南北向约 7.5 m、主体厚度 0.48 m，共拆成 14 个可独立点击、抬升和高亮的区域。

最终网页模型采用 4,108 三角面、14 个模型 Draw Calls、3 张 1024×1024 KTX2 PBR 纹理，GLB 为 1,018,232 bytes。Three.js 已完成自动居中/缩放、相机、灯光、OrbitControls、热点投影、区域选择、部件抬升、移动端适配和实时指标采集。

![最终网页桌面界面](../reports/web-desktop-chrome.png)

![最终网页移动界面](../reports/web-mobile-emulation.png)

---

## 2. 完整流水线与独立版本

```mermaid
flowchart LR
  A["多视图与比例分析"] --> B["结构拆解"]
  B --> C["基础形体"]
  C --> D["形体精修"]
  D --> E["高模细节"]
  E --> F["低模拓扑"]
  F --> G["UV 展开"]
  G --> H["Normal / AO 烘焙"]
  H --> I["PBR 材质"]
  I --> J["KTX2"]
  J --> K["GLB"]
  K --> L["Three.js 交互"]
```

每个 Blender 阶段均为独立文件，没有覆盖上一阶段：

| 阶段 | 文件 | 内容 |
|---|---|---|
| A01 | `blender/A01_structure_breakdown.blend` | 总轮廓、14 区域、结构编号 |
| A02 | `blender/A02_base_shape.blend` | 平面分区与基础厚度 |
| A03 | `blender/A03_shape_refined.blend` | 外轮廓与区域缝精修 |
| A04 | `blender/A04_highpoly_detail.blend` | 高模边界轨与点阵细节 |
| A05 | `blender/A05_lowpoly_retopology.blend` | 网页低模、单段倒角 |
| A06 | `blender/A06_uv_unwrapped.blend` | 全局比例 UV 与侧壁条带 |
| A07 | `blender/A07_baked_pbr.blend` | Normal/AO 烘焙与 PBR 接线 |
| A08 | `blender/A08_export_ready.blend` | PART/HOTSPOT 命名、最终导出态 |

### A01 — 结构拆解

![结构拆解](../renders/A01_structure_breakdown.png)

### A02 — 基础形体

![基础形体](../renders/A02_base_shape.png)

### A03 — 形体精修

![形体精修](../renders/A03_shape_refined.png)

### A04 — 高模细节

![高模细节](../renders/A04_highpoly_detail.png)

### A05 — 低模拓扑

![低模拓扑](../renders/A05_lowpoly_retopology.png)

### A06 — UV 展开

![UV 阶段](../renders/A06_uv_unwrapped.png)

### A07 — 烘焙与 PBR

![烘焙与 PBR](../renders/A07_baked_pbr.png)

### A08 — 导出态

![最终导出态](../renders/A08_export_ready.png)

---

## 3. 几何、拓扑和坐标

| 项目 | 结果 | 预算 |
|---|---:|---:|
| 区域数量 | 14 | 14 |
| 网格对象 | 14 | ≤ 18 Draw Calls |
| 顶点 | 2,082 | — |
| 三角面 | 4,108 | ≤ 12,000 |
| 主体厚度 | 0.48 m | 0.42–0.55 m |
| 外轮廓宽度 | 约 12 m | 比例基准 |

Blender 源使用 Z-up；导出 glTF 后由标准坐标变换呈现为 Y-up。每个区域的原点位于自身几何中心，适合抬升、爆炸图或按数据驱动高度。区域之间使用真实缝隙，而不是依赖一张二维边界图，因此在斜视角下仍可读。

### 节点层级

```text
A_CUSTOM_MAP_ROOT
├── PART__REGION_01 … PART__REGION_14
└── HOTSPOT__REGION_01 … HOTSPOT__REGION_14
```

`PART__*` 节点 extras：

```json
{
  "part_type": "region",
  "region_id": "14",
  "display_name": "南海",
  "data_value": 90,
  "interactive": true,
  "hotspot": "HOTSPOT__REGION_14"
}
```

`HOTSPOT__*` 节点 extras：

```json
{
  "target": "PART__REGION_14",
  "region_id": "14",
  "display_name": "南海",
  "data_value": 90
}
```

---

## 4. UV 与 PBR 贴图

地图使用一套共享全局 UV，使 14 个分区上的点阵连续、比例一致。顶面集中在 UV 的 0.08–0.92 安全区；侧壁映射到深色条带，从而只需一个材质和一组贴图，不增加第二套材质 Draw Call。烘焙边距为 12 px。

![UV 布局](../textures/png/Map_UV_Layout.png)

### Base Color

![Base Color](../textures/png/Map_BaseColor.png)

### Normal

![Normal](../textures/png/Map_Normal.png)

### AO

![AO](../textures/png/Map_AO.png)

### Roughness

![Roughness](../textures/png/Map_Roughness.png)

### Metallic

![Metallic](../textures/png/Map_Metallic.png)

### ORM 打包

![ORM](../textures/png/Map_ORM.png)

`Map_ORM.png` 遵循 glTF 通道约定：R=AO、G=Roughness、B=Metallic。Normal 与 AO 均使用 Blender selected-to-active 烘焙，高模源为 `HIGH__BOUNDARY_AND_DOTS`，低模目标为 `BAKE_TARGET__MAP_TOP`，分辨率 1024²。

---

## 5. KTX2 与 GLB

| 贴图 | KTX2 模式 | 文件体积 | 运行时估算 GPU |
|---|---|---:|---:|
| Base Color / Emissive | ETC1S | 78.35 KB | 699.05 KB |
| Normal | UASTC + RDO + Zstd | 105.79 KB | 1.40 MB |
| ORM | UASTC + RDO + Zstd | 463.40 KB | 1.40 MB |

Normal 和 ORM 使用 UASTC，优先保持法线和数据通道精度；Base Color 使用 ETC1S，优先减小网络体积。最终 GLB 声明并要求 `KHR_texture_basisu`。

| 导出版本 | 用途 | 大小 |
|---|---|---:|
| `A_custom_map_low_raw.glb` | PNG 原始基线 | 1.21 MB |
| `A_custom_map_low_normal_uastc.glb` | Normal 完成 UASTC | 1.24 MB |
| `A_custom_map_low_uastc.glb` | Normal + ORM 完成 UASTC | 1.18 MB |
| `A_custom_map_low_ktx2.glb` | 最终混合压缩交付 | 1.02 MB / 0.97 MiB |

压缩脚本：`source/scripts/optimize_glb.sh`。项目内 KTX Software 为 4.4.2，官方包校验值：

```text
500bd8f9d63358c3f3a0d83b724c8574436a72c37dc0e4bad90ec1ca38032c3c
```

---

## 6. Three.js 接入实现

网页源码位于 `web/src/main.js` 和 `web/src/style.css`。核心行为如下：

1. `KTX2Loader.detectSupport(renderer)` 根据设备选择可用 GPU 压缩格式。
2. `GLTFLoader` 加载最终 KTX2 GLB。
3. `Box3` 读取包围盒，模型放入 `MODEL_AUTO_CENTER_SCALE` 容器后自动居中并缩放。
4. 移动端根据水平/垂直 FOV 与包围球自动计算相机距离，保证全图入镜。
5. 半球光、主方向光和青色轮廓点光共同恢复参考视频的全息青色效果。
6. `OrbitControls` 支持拖动旋转、滚轮/双指缩放、阻尼与自动巡航。
7. Raycaster 命中 `PART__*` 后克隆材质的 emissive 参数并抬升该分区。
8. `HOTSPOT__*` 的世界坐标每帧投影到 DOM 标签，标签点击会选择对应 PART。
9. `window.__APP_METRICS` 暴露加载、面数、Draw Call、GPU 内存估算和 FPS，供自动化与页面面板共同使用。

关键选择 API：

```js
window.selectPartByName('PART__REGION_14');
```

这可直接接入业务表格、告警列表或 WebSocket 实时数据。

---

## 7. 性能与兼容性验证

### 静态资产验证

```text
GLB 2.0 header: PASS
KHR_texture_basisu: required / PASS
PART__*: 14 / PASS
HOTSPOT__*: 14 / PASS
Hotspot target mapping: PASS
Triangles: 4,108 / PASS
File size: 1,018,232 bytes / PASS
```

### 浏览器自动化

| 档位 | 环境 | 加载时间 | FPS | Draw Calls | 估算显存 | 结果 |
|---|---|---:|---:|---:|---:|---|
| 桌面 | Chrome 1440×900，本地网络，Apple M5 ANGLE Metal | 100 ms | 120 | 15 | 4.61 MiB | PASS |
| 移动仿真 | Pixel 7 viewport/touch/UA，4× CPU，4 Mbps/80 ms | 3,420 ms | 120 | 15 | 4.61 MiB | PASS |

测试同时验证：加载无控制台错误、14 个 PART、14 个 HOTSPOT、选择 API、详情面板更新、区域按钮激活、三角面/文件/显存/Draw Call/FPS 预算。

报告文件：

- `reports/performance-desktop-chrome.json`
- `reports/performance-mobile-emulation.json`
- `reports/web-desktop-chrome.png`
- `reports/web-mobile-emulation.png`
- `reports/npm-audit-production.json`
- `reports/npm-audit-full.json`

注意：移动测试使用真实的移动视口、触控事件模型、UA、CPU 与网络限速，但 GPU 仍是桌面测试机。上线前应在目标 Android/iOS 设备上补一次真机冷缓存测试，尤其关注 Safari 的 KTX2 转码、系统发热后的持续 FPS 和低内存设备的纹理回收。

---

## 8. 目录说明

```text
A_custom_map/
├── blender/              # A01–A08 独立 Blender 版本
├── renders/              # 每阶段 960×640 验证渲染
├── source/
│   ├── map_spec.json     # 尺寸、材料、预算、区域种子
│   ├── generated/        # SVG 外轮廓与区域几何 JSON
│   └── scripts/          # 生成、Blender、压缩和验证脚本
├── textures/
│   ├── png/              # UV 与完整 PBR PNG
│   └── ktx2/             # 拆包后的独立 KTX2
├── export/               # 原始、中间与最终 GLB
├── web/                  # Three.js / Vite 源码
├── dist/                 # 可部署静态页面
├── tests/                # Playwright 桌面/移动测试
├── reports/              # 指标、日志、测试 JSON 与截图
└── tooling/              # 已校验的项目内 KTX 工具链
```

---

## 9. 重建、部署与后续业务接入

### 重新生成源几何

```bash
python3 source/scripts/generate_source_assets.py
```

### 重新生成 8 个 Blender 阶段

```bash
/Applications/Blender.app/Contents/MacOS/Blender \
  --background \
  --python source/scripts/build_blender_pipeline.py
```

### 重新压缩 KTX2 / GLB

```bash
source/scripts/optimize_glb.sh
```

### 构建与测试网页

```bash
npm install
npm run validate:glb
npm run build
npm test
npm audit
```

`dist/` 是纯静态产物，可部署到 Nginx、对象存储或任意静态站点平台。服务器应为 `.ktx2` 返回 `image/ktx2`，并对 `.glb`、`.wasm`、`.ktx2` 启用长期缓存；首次上线时保留内容哈希或版本化路径，避免旧缓存与新模型错配。

后续接业务数据时，建议只通过 `region_id` 或 `PART__REGION_*` 建立映射，不要依赖中文显示名；显示名可国际化，而稳定 ID 不变。实时态势数据只修改材质参数、区域高度和详情面板，无需重新下载 GLB。
