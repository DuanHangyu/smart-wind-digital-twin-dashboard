# B 艺术化风场地形 V4（表面与烘焙精修版）

V4 基于已提交的 V3 风机精修版本继续制作，不修改 V3 目录。宏观地形、湖泊轮廓、三台风机点位和精修风机保持不变，重点重做地形 Base Color、Normal、AO、Roughness、Metallic 及灯光预览。

![V3 与 V4 同机位对比](reports/render_v3_v4_comparison.png)

- [V4 图文交付说明](docs/B_艺术化风场地形_V4_表面与烘焙精修交付说明.md)
- [最终 Blender](blender/B08_export_ready.blend)
- [最终 KTX2 GLB](export/B_windfarm_terrain_low_ktx2.glb)
- [PBR 分层图](reports/surface_material_breakdown.png)
- [贴图对比图](reports/surface_texture_comparison.png)
- [Three.js 交互代码](web/src/main.js)

## 最终指标

- GLB：3,028,352 B（2.89 MiB）
- 三角面：41,120 / 45,000
- Draw Calls：22（离线）/ 23（桌面实测）
- Base Color 参考偏差：0.021203 / 0.06
- 宽尺度烘焙明暗残留：V4 为源图的 69.89%
- Normal XY：P50 0.057901，P95 0.243074
- AO：0.502–1.000；Roughness：0.655–0.875；Metallic：0
- 桌面加载：265 ms；Pixel 7 / 4 Mbps 模拟加载：7.570 s
- 估算显存：4.85 MB；桌面/移动测试均 120 FPS（无头 Chrome 上限）

## 复现

```bash
./.venv/bin/python source/scripts/generate_terrain_data.py
./.venv/bin/python source/scripts/generate_textures.py
/Applications/Blender.app/Contents/MacOS/Blender --background --python source/scripts/build_blender_pipeline.py
./.venv/bin/python source/scripts/validate_fidelity.py
./.venv/bin/python source/scripts/validate_surface.py
KTX_RUNTIME_DIR=/path/to/ktx-runtime bash source/scripts/optimize_glb.sh
./.venv/bin/python source/scripts/inspect_glb.py export/B_windfarm_terrain_low_ktx2.glb
npm run build
npm test
```

V3 稳定基线仍完整保留在相邻的 `B_artistic_windfarm_terrain_v3_turbine_refined` 目录。
