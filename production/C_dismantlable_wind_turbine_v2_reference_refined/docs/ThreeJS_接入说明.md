# Three.js 接入说明

入口文件：`web/src/main.js`；最终模型：`web/public/models/C_dismantlable_turbine_v2_low_ktx2.glb`。

核心接入顺序：

1. 创建 WebGLRenderer、透视相机、OrbitControls 和三点灯光。
2. 为 GLTFLoader 注入 KTX2Loader，并把 Basis 解码器路径设为 `/basis/`。
3. 加载后遍历 `PART__*`、`HOTSPOT__*` 和 `ROTOR__*` 节点。
4. 通过 Box3 计算中心与最大边，自动移动根节点并缩放至统一画幅。
5. 保存每个部件的初始位置和材质，以便爆炸、复位和透视模式可逆。
6. 使用 Raycaster 和部件列表调用同一个选择函数，保证两种入口状态一致。
7. 移动端限制 renderer pixelRatio，避免高 DPI 屏幕造成过量填充率。

本地运行：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

自动化检查覆盖桌面 Chrome 和 Pixel 7 模拟档位：

```bash
npm test
```
