# C 可拆解风机 V3 比例校正版

V3 针对外观六视图重新校正整机比例，保留 V2，不覆盖上一版本。此次不是单独拉长叶片，而是联动调整叶轮、塔筒、轮毂、偏航座和机舱长宽高，使正视、侧视和三分之四视角保持一致。

![V3 最终六视图](reports/final_six_view_board.png)

## 最终比例

| 项目 | V2 | V3 | 调整目的 |
|---|---:|---:|---|
| 叶轮半径 | 3.1044 m | 4.4550 m | 匹配参考图长叶片轮廓 |
| 叶轮半径/轮毂高度 | 0.474 | 0.6802 | 进入参考估算 0.66–0.70 区间 |
| 塔筒底部半径 | 0.70 m | 0.60 m | 消除塔底偏粗感 |
| 塔筒顶部半径 | 0.43 m | 0.33 m | 使塔筒更修长、锥度更明确 |
| 轮毂半径 | 0.40 m | 0.36 m | 降低机头视觉重量 |
| 机舱长×宽×高 | 2.75×1.50×1.28 m | 3.22×1.36×1.12 m | 由短胖胶囊改为修长机舱 |

![参考图、V2 与 V3 比例对照](reports/proportion_reference_v2_v3.png)

## 交付内容

- `blender/C01_structure_breakdown.blend` 至 `C08_export_ready.blend`
- `export/C_dismantlable_turbine_v3_low_ktx2.glb`
- Base Color、Normal、AO、Roughness、Metallic、ORM、KTX2 全套贴图
- 15 个 `PART__*`、9 个 `HOTSPOT__*`、1 个 `ROTOR__ASSEMBLY`
- Three.js 外观、透视、爆炸、网格、选择、自动居中缩放和转子旋转
- Blender、GLB、桌面和模拟手机端验证报告

详细比例分析见 [`docs/C_V3_比例校正说明.md`](docs/C_V3_比例校正说明.md)。
