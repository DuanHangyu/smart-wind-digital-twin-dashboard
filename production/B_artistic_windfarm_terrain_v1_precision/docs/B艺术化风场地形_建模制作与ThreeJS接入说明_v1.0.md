# B 艺术化风场地形：建模制作与 Three.js 接入说明 v1.0

版本：Production V1  
资产编号：`B_ARTISTIC_WINDFARM_TERRAIN_V1_PRECISION`  
制作基准：3 张锁定多视图参考图  
交付目标：Blender 可编辑源文件 + 网页实时低模 + PBR/KTX2 + GLB + Three.js 交互页

---

## 1. 交付结论

本次不是停留在概念图或建模建议，而是已经完成从参考分析到网页验收的整条生产流水线：

> 多视图参考图 → 结构拆解 → 基础形体 → 形体精修 → 高模细节 → 低模拓扑 → UV 展开 → Normal/AO 烘焙 → Base Color/Roughness/Metallic → KTX2 → GLB → Three.js → 桌面与手机测试

![桌面端最终效果](../reports/web-desktop-chrome.png)

![Blender 最终实体效果](../renders/B08_export_ready.png)

最终模型保持参考图的核心识别特征：

- 横向矩形地台，长宽比约 `14:9`；
- 四组连续山脊和多级支脊，形成前、中、后三层空间；
- 左前方不规则湖泊；
- 三台风机分别位于中左、中后和右侧高地；
- 灰绿岩石/植被分区；
- 可切换青色全息三角线框；
- 风机、湖泊具备独立部件与热点语义。

### 重要精度边界

三张参考图是透视渲染图，不含真实 DEM、正交四视图、镜头参数或尺寸标尺。因此本资产可做到“构图、比例关系、山脊分组、材质语言和交互结构的高一致复刻”，不能声称测绘级或毫米级逆向。不可见区域采用连续地貌原则补全；该边界已经写入资产元数据和验收报告。

---

## 2. 锁定参考图与逐图分析

### 2.1 实体彩质六视图

![实体彩质六视图](../source/reference/reference_six_views_solid.png)

可提取信息：

- 地块外形近似 1.55:1 的横向矩形，四边略有自然起伏但总体保持直边地台；
- 湖泊位于画面左前象限，面积约占地块 3%；
- 风机数量固定为 3，避免把远景尖峰误判为风机；
- 主要山脊不是随机散点山峰，而是横向/斜向连续山链；
- 山体最高点约为地块短边的 26%，风机塔高约为最高地形的 54%；
- 参考没有严格镜像对称，必须保持非对称自然地貌。

### 2.2 高度、材质与结构拆分参考

![高度与结构参考](../source/reference/reference_structure_material.png)

可提取信息：

- 左上灰度图对应高度趋势，可用于锁定高地、谷地和湖盆；
- 右上材质图表明：植被主色为黄绿/深绿，陡坡与高海拔出现灰白岩石；
- 下方结构图表明湖面和三个风机锚点应作为独立对象；
- 湖面不能只画进 Base Color，应保留独立水体几何以便选择、替换材质和读写水位；
- 风机是 B 地形资产中的位置/比例代理模型，详细可拆解机舱属于后续 C 资产。

### 2.3 全息线框六视图

![全息线框六视图](../source/reference/reference_six_views_wireframe.png)

可提取信息：

- 线框是三角拓扑的实时表现，不是贴图中画出的固定线；
- 山脊区域三角形视觉密度高，平坦草地可更稀疏；
- 网页端必须允许实体/线框切换，并保持热点和转子交互；
- 线框为青色、黑青背景、关闭深度写入，避免大量三角线相互遮挡成黑块。

---

## 3. 建模前结构分析

### 3.1 整体比例

| 项目 | 锁定值 |
|---|---:|
| 地形宽度 | 14.00 m |
| 地形深度 | 9.00 m |
| 宽深比 | 1.555556 |
| 地台厚度 | 0.18 m |
| 地形有效高差 | 2.35 m |
| 湖面高度 | 0.27 m |
| 风机塔高 | 1.28 m |
| 风轮半径 | 0.34 m |

这里的“米”是统一资产单位，不代表参考场景的真实地理尺寸；它保证 Blender、GLB 和 Three.js 的缩放与灯光计算一致。

### 3.2 主要结构

1. `PART__BASE`：黑青色薄地台，提供视觉厚度和悬浮底座感。
2. `PART__TERRAIN`：连续地形主体，含顶面与封边裙边。
3. `PART__LAKE`：独立不规则湖面，可单独选择和换材质。
4. `PART__TURBINE_01`：中左风机，运行态。
5. `PART__TURBINE_02`：中后风机，待检态。
6. `PART__TURBINE_03`：右侧风机，运行态。

### 3.3 对称关系

地形不采用镜像。四组主山脊、十组支脊、十四个峰值控制点使用非对称布局；只有每台风机自身的三叶片采用 120° 旋转阵列。这样既保持参考构图，又避免程序地形常见的棋盘/镜像感。

### 3.4 材质分区

| 分区 | 判定 | Base Color | Roughness | Metallic |
|---|---|---|---:|---:|
| 草坡 | 低/中坡度，低/中海拔 | 深绿至黄绿 | 0.62–0.78 | 0.015 |
| 岩壁 | 高坡度或高海拔 | 灰褐至灰白 | 0.72–0.92 | 0.015 |
| 湖面 | 独立几何 | 蓝灰/青灰 | 0.20 | 0.28 |
| 风机 | 独立几何 | 灰白，深色轮毂 | 0.34–0.42 | 0.18–0.50 |
| 地台/裙边 | 独立材质 | 深黑青 | 0.62–0.78 | 0.04–0.12 |

最终岩石覆盖率为 `21.18%`，以避免初稿中过度绿色、山体读不出结构的问题。

### 3.5 可独立操作部件

```text
B_WINDFARM_TERRAIN_ROOT
├── PART__BASE
├── PART__TERRAIN
├── PART__LAKE
├── PART__TURBINE_01
│   └── ROTOR__TURBINE_01
├── PART__TURBINE_02
│   └── ROTOR__TURBINE_02
├── PART__TURBINE_03
│   └── ROTOR__TURBINE_03
├── HOTSPOT__LAKE
├── HOTSPOT__TURBINE_01
├── HOTSPOT__TURBINE_02
└── HOTSPOT__TURBINE_03
```

`PART__*` 用于射线选择、显隐和状态高亮；`HOTSPOT__*` 用于二维标签投影；`ROTOR__*` 用于转速动画。风机 02 的 `rpm=0` 对应待检状态，风机 01/03 分别为 8.2/9.1 rpm。

---

## 4. 八阶段非覆盖式 Blender 制作

每个阶段保存为独立 `.blend`，后续阶段不会覆盖前一阶段。

### B01 结构拆解

![B01 结构拆解](../renders/B01_structure_breakdown.png)

文件：`blender/B01_structure_breakdown.blend`。确认地台、地形、湖泊、三台风机的对象所有权和可拆分关系。

### B02 基础形体

![B02 基础形体](../renders/B02_base_shape.png)

文件：`blender/B02_base_shape.blend`。使用 `65×49` 网格建立主峰组、主谷地和整体高差，不加入细碎噪声。

### B03 形体精修

![B03 形体精修](../renders/B03_shape_refined.png)

文件：`blender/B03_shape_refined.blend`。使用 `257×193` 网格补足四组主山脊、支脊、S 形谷地和湖盆岸线。

### B04 高模细节

![B04 高模细节](../renders/B04_highpoly_detail.png)

文件：`blender/B04_highpoly_detail.blend`。加入两级扭曲脊线噪声、中尺度岩肋、侵蚀纹理和灰绿材质分区，作为烘焙源。

### B05 低模拓扑

![B05 网页低模线框](../renders/B05_lowpoly_retopology.png)

文件：`blender/B05_lowpoly_retopology.blend`。网页网格为 `129×97`，使用交错三角划分和独立封边。最终 GLB 为 27,076 三角面，低于 45,000 面预算。

### B06 UV 展开

![B06 UV 检查](../renders/B06_uv_unwrapped.png)

文件：`blender/B06_uv_unwrapped.blend`。地形顶面采用 0–1 平面投射；裙边使用窄条 UV，最终又通过独立裙边材质避免顶面贴图在侧边产生拉伸黑块。

### B07 Normal / AO 烘焙

![B07 烘焙后 PBR](../renders/B07_baked_pbr.png)

文件：`blender/B07_baked_pbr.blend`。从 `257×193` 高模到 `129×97` 低模做 Selected-to-Active Normal/AO 烘焙，边距 16 px；再把中尺度侵蚀法线与烘焙法线规范化合成，保留网页低模上的岩肋读感。

### B08 导出就绪

![B08 导出就绪](../renders/B08_export_ready.png)

文件：`blender/B08_export_ready.blend`。加入完整节点命名、热点元数据、风机状态/功率/转速字段，并导出原始 GLB。

补充视角：

| 顶视 | 前视 |
|---|---|
| ![顶视](../renders/B08_view_top.png) | ![前视](../renders/B08_view_front.png) |

| 侧视 | 后侧透视 |
|---|---|
| ![侧视](../renders/B08_view_side.png) | ![后视](../renders/B08_view_rear.png) |

---

## 5. UV 与 PBR 贴图

贴图分辨率统一为 `1024×1024`，兼顾近景表面读感与移动端内存。

| Base Color | Normal |
|---|---|
| ![Base Color](../textures/png/Terrain_BaseColor.png) | ![Normal](../textures/png/Terrain_Normal.png) |

| AO | Roughness |
|---|---|
| ![AO](../textures/png/Terrain_AO.png) | ![Roughness](../textures/png/Terrain_Roughness.png) |

| Metallic | ORM |
|---|---|
| ![Metallic](../textures/png/Terrain_Metallic.png) | ![ORM](../textures/png/Terrain_ORM.png) |

ORM 通道定义：`R=AO`、`G=Roughness`、`B=Metallic`。Base Color 以 ETC1S 压缩，Normal 与 ORM 使用 UASTC，避免法线/数据贴图出现明显块状误差。

KTX2 文件：

- `textures/ktx2/baseColor_1.ktx2`：约 174 KB；
- `textures/ktx2/normal_1.ktx2`：约 1.1 MB；
- `textures/ktx2/occlusion_1.ktx2`：约 951 KB，同时服务 AO 与 Metallic/Roughness。

---

## 6. GLB 压缩与验证

压缩顺序：

1. 原始 GLB：3,991,808 B；
2. POSITION 16-bit、NORMAL 10-bit、UV 12-bit 量化；
3. Normal → UASTC + Zstd；
4. ORM → UASTC + Zstd；
5. Base Color → ETC1S；
6. 最终 `B_windfarm_terrain_low_ktx2.glb`：2,814,356 B。

最终使用并要求：

- `KHR_mesh_quantization`
- `KHR_texture_basisu`

GLB 静态审计结果：6 个 `PART__*`、4 个 `HOTSPOT__*`、3 个 `ROTOR__*`、21 个 Mesh、6 个材质、27,076 三角面，全部通过。

---

## 7. Three.js 接入设计

实现位于 `web/src/main.js`，主要能力如下：

- `GLTFLoader + KTX2Loader` 加载最终 GLB；
- 依据包围盒自动计算中心与统一缩放；
- 自动配置透视相机、OrbitControls、近远裁剪和手机像素比；
- 半球光 + 主方向光 + 青色轮廓光；
- 拖动旋转、滚轮/双指缩放、自动巡航和复位视角；
- Raycaster 点击模型，向上查找最近 `PART__*`；
- 把 `HOTSPOT__*` 的三维世界坐标投影成二维 DOM 标签；
- 根据 `rpm` 驱动三个 `ROTOR__*`；
- 运行时由 `WireframeGeometry` 生成青色全息三角网；
- 实体/全息线框切换后仍保留选择和热点交互；
- 采集模型体积、三角面、Draw Calls、估算显存、加载时间和 FPS。

![桌面端全息与热点交互](../reports/web-desktop-chrome.png)

![移动端交互](../reports/web-mobile-emulation.png)

---

## 8. 保真度与性能验收

### 8.1 高低模几何保真

![主高度场与低模叠加图](../reports/master_vs_lowpoly_height_overlay.png)

叠加图中红色为 513×385 主高度场，绿色为 129×97 低模重建；黄色区域表示二者高度一致。

| 指标 | 实测 | 门槛 | 结果 |
|---|---:|---:|---|
| 归一化高度 RMSE | 0.004286 | ≤ 0.025 | 通过 |
| 前轮廓 RMSE | 0.015529 | ≤ 0.035 | 通过 |
| 侧轮廓 RMSE | 0.021221 | ≤ 0.035 | 通过 |
| 湖面面积误差 | 0.001060 | ≤ 0.003 | 通过 |
| 湖心误差 | 0.000649 | ≤ 0.012 | 通过 |
| 风机锚点最大误差 | 0 | ≤ 0.000001 | 通过 |

### 8.2 浏览器性能

| 指标 | 桌面 Chrome | Pixel 7 限速仿真 | 门槛 |
|---|---:|---:|---:|
| GLB 传输 | 2.68 MB | 2.68 MB | ≤ 5.00 MB |
| 加载时间 | 196 ms | 7,070 ms | < 10,000 ms |
| 网页三角面 | 26,628 | 26,628 | ≤ 45,000 |
| Draw Calls | 23 | 23 | ≤ 28 |
| 估算显存 | 4.34 MB | 4.34 MB | ≤ 18 MB |
| FPS | 120 | 120 | ≥ 25 |
| Console Error | 0 | 0 | 0 |

手机档位采用 Pixel 7 viewport/touch/user-agent、4× CPU slowdown、4 Mbps 下载和 80 ms 网络延迟。FPS 仍取自同一台 Apple M5 的 Headless GPU，因此上线前应使用目标安卓真机再次校准温升、持续帧率和内存峰值。

---

## 9. 完整交付清单

| 类型 | 位置 |
|---|---|
| Blender 八阶段 | `blender/B01_*.blend` 至 `blender/B08_*.blend` |
| 网页低模源 | `blender/B05_lowpoly_retopology.blend` |
| 最终 Blender | `blender/B08_export_ready.blend` |
| UV 检查 | `textures/png/Terrain_UV_Checker.png` |
| PBR PNG | `textures/png/Terrain_*.png` |
| KTX2 | `textures/ktx2/*.ktx2` |
| 最终 GLB | `export/B_windfarm_terrain_low_ktx2.glb` |
| Three.js | `web/index.html`、`web/src/main.js`、`web/src/style.css` |
| 生产构建 | `dist/` |
| 保真报告 | `reports/fidelity_metrics.json` |
| GLB 审计 | `reports/glb_validation.json` |
| 桌面性能 | `reports/performance-desktop-chrome.json` |
| 手机性能 | `reports/performance-mobile-emulation.json` |
| 自动化脚本 | `source/scripts/*.py`、`source/scripts/optimize_glb.sh` |

---

## 10. 复现与验收命令

```bash
# 1. 重建高度数据和贴图
.venv/bin/python source/scripts/generate_terrain_data.py
.venv/bin/python source/scripts/generate_textures.py

# 2. Blender 八阶段、烘焙与原始 GLB
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --python source/scripts/build_blender_pipeline.py

# 3. KTX2 与最终 GLB
bash source/scripts/optimize_glb.sh

# 4. 静态验收
npm run validate:fidelity
npm run validate:glb

# 5. 网页构建与电脑/手机测试
npm run build
npm test
```

如果以后替换真实 DEM，只需要让新的高度场继续输出相同的网格尺寸、UV 约定和节点命名，Three.js 交互层无需重写。
