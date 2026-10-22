# EIT Lab · 电阻抗成像实验室

一个完全在浏览器本地运行的二维 EIT 模拟工作台。TypeScript 数值核心在 Web Worker 中运行，Canvas 展示真实电导率、电势/电流方向、差分重建及边界测量。无服务端、无远程数据依赖。

## 启动

```sh
nix develop
npm ci
npm run dev
```

打开终端显示的本地地址（默认 `http://127.0.0.1:5173`）。`flake.nix` 和 `flake.lock` 固定 Node.js 工具链与 nixpkgs；`package-lock.json` 固定前端依赖。支持 Apple Silicon macOS、aarch64 / x86_64 Linux（当前 nixpkgs 不再支持 Intel macOS）。首次使用 Nix 可能需要启用 `nix-command flakes`。

```sh
npm run build       # TypeScript 检查 + 静态站点 dist/
npm run preview     # 预览构建结果
npm test            # 数值回归测试
npm run benchmark   # 冷启动与缓存后重复求解耗时
npm run test:ui     # Chromium 浏览器集成测试（先安装浏览器，见下）
```

UI 测试默认使用 Playwright Chromium；先执行 `npx playwright install chromium`。也可用已有 Chrome，例如 macOS：

```sh
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:ui
```

## 交互

- 边界：圆、椭圆、胸廓、自定义多边形；可调纵横比、旋转、径向网格。
- 多边形：3–32 个顶点，按笛卡尔坐标逆时针排列，坐标在 `[-1,1]`，原点须位于星形内核。边界不可自交；所有顶点都会纳入有限元边界。极小三角形会触发错误提示。
- 电极：8 / 12 / 16 / 24 / 32 个，按极角分布。相邻、对向、可调跨距注流；每次扫描测量未接触注流电极的相邻电压差。
- 激励：1–1000 kHz，0.1–10 mA 正弦幅值；噪声 0–5% 参考电压 RMS，可调随机种子。
- 介质：背景与最多 8 个圆形目标；拖动目标或用滑块调整坐标、半径、电导率。目标超出边界的部分被截去，重叠处后面的目标优先。
- 重建：对数尺度正则化控制、真实误差与电压拟合误差、参考/正向/逆向分段耗时。
- 扫描播放展示已求解的各注流电势场；修改物理配置会重新计算整轮扫描。
- 导出/导入版本化实验 JSON；CSV 包含所有扫描的注流对、测量对、参考电压、带噪测量、差分电压，单位 V。

## 数学模型

正向使用二维线性三角形有限元求解 `∇·(σ∇u)=0`，边界绝缘，注流为边界节点上的点电极。中心节点固定为零电势以消除常数零空间。稀疏 CSR 刚度矩阵由 Jacobi 预条件共轭梯度求解，目标相对残差 `1e-9`；残差大于 `1e-6` 时拒绝输出。

归一化坐标单位为 0.1 m，圆形默认半径 0.09 m；截面厚度固定 0.1 m。二维刚度矩阵的面内尺度相消，电压按 `电流(A) / 厚度(m)` 缩放。显示电流方向为 `−σ∇u` 的归一化方向，箭头长度不表示幅度。

频率模型使用可调的**实电导率色散**：

```text
σ(f) = σ₀ × [1 + D × f² / (f² + f꜀²)]
```

所有介质共用 D 和 f꜀，各自设置 σ₀。界面中的图像表示当前频率的有效 σ。该模型计算同相响应，不实现复导纳相位、完整电极接触阻抗或仪器电路。不是完整 Maxwell 求解器。

差分重建在同几何、同频率、均匀背景参考场上，通过伴随法计算每个三角形的灵敏度：

```text
J[m,t] = −area(t) × ∇u_drive(t) · ∇u_sense(t)
y = V_measured − V_reference
(JᵀJ + αI) Δσ = Jᵀy
α = λ × max diag(JᵀJ)
σ_reconstructed = σ_reference + Δσ
```

三角形按重心归并到 16×16 笛卡尔分区，降低逆问题维数。逆问题矩阵乘法不显式构建 `JᵀJ`；PCG 最多 120 次迭代。参考场与 Jacobian 按几何/激励/背景/频率缓存，目标拖动不重建参考。测量噪声采用固定种子的 Box–Muller 高斯采样，标准差为参考测量 RMS 的指定百分比。

误差：RMSE 按三角形面积加权；电压拟合误差为 `‖JΔσ−y‖₂/‖y‖₂`。重建不做正值截断；高对比度、低正则化或噪声可能产生负值。真实场和重建图共用色标，保留过冲信息。

方法参考：[EIDORS 伴随 Jacobian](https://sce.carleton.ca/faculty/adler/eidors/doc/eidors/solvers/forward/jacobian_adjoint.html)。这是独立实现，没有使用 EIDORS 运行时。

## 工程结构

```text
src/solver.ts    网格、刚度矩阵、PCG、伴随 Jacobian、差分重建
src/worker.ts    异步计算与错误协议
src/main.ts      控件、Canvas 绘制、实验导入导出
src/style.css   响应式界面
tests/         数值性质、性能与浏览器交互验证
flake.nix       Nix 开发工具链
```

Worker 对更新请求合并处理，忽略过期结果；主线程可以继续响应操作。默认 16 电极/8 层适合交互，32 电极/14 层为高精度模式，耗时由硬件与浏览器决定；界面报告实际求解时间。当前不需要 Rust 后端。若扩展到 3D、复导纳完整电极模型或上百电极，可保留 Worker 协议，将求解核心替换为 Rust/WASM。

## 已测性能

本机 Apple Silicon、Nix Node.js 22，10 次改变目标位置的缓存后求解（不含 Canvas 绘制及线程传输）：

| 配置            | 节点 / 单元 | 首次   | 缓存后中位数 | 缓存后 P90 |
| --------------- | ----------- | ------ | ------------ | ---------- |
| 16 电极 / 8 层  | 385 / 720   | 54 ms  | 14 ms        | 16 ms      |
| 32 电极 / 14 层 | 1345 / 2592 | 410 ms | 153 ms       | 183 ms     |

以上是一次本机基准，不是跨设备保证。Chrome 浏览器集成验证默认配置首次 Worker 求解约 63 ms；实际耗时始终显示在界面。默认网格适合实时交互，高网格适合数次每秒更新，扫描播放复用结果。
