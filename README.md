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
- 重建：Tikhonov、GREIT、TV、L1/FISTA；顶部快速切换算法，侧栏暴露专属参数；显示收敛状态、真实误差、电压拟合误差和分段耗时。
- 扫描播放展示已求解的各注流电势场；修改物理配置会重新计算整轮扫描。
- 导出/导入版本化实验 JSON（v2 保存算法参数，兼容旧 v1，缺失的新参数自动填入默认值）；CSV 包含所有扫描的注流对、测量对、参考电压、带噪测量、差分电压，单位 V。

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

三角形按重心归并到 16×16 笛卡尔分区，降低逆问题维数。重建核心缓存稠密小矩阵 `G=JᵀJ/s`（`s=max diag(JᵀJ)`）以及所需的 Cholesky 分解或 GREIT 算子。参考场与 Jacobian 按几何/激励/背景/频率缓存，目标拖动不重建参考。测量噪声采用固定种子的 Box–Muller 高斯采样，标准差为参考测量 RMS 的指定百分比。

误差：RMSE 按三角形面积加权；电压拟合误差为 `‖JΔσ−y‖₂/‖y‖₂`。重建不做正值截断；高对比度、低正则化或噪声可能产生负值。真实场和重建图共用色标，保留过冲信息。

方法参考：[EIDORS 伴随 Jacobian](https://sce.carleton.ca/faculty/adler/eidors/doc/eidors/solvers/forward/jacobian_adjoint.html)。这是独立实现，没有使用 EIDORS 运行时。

## 工程结构

```text
src/solver.ts    网格、刚度矩阵、PCG、伴随 Jacobian、模拟管线
src/reconstruction.ts  Tikhonov / GREIT / TV / L1、分解与算子缓存
src/worker.ts    异步计算与错误协议
src/main.ts      控件、Canvas 绘制、实验导入导出
src/style.css   响应式界面
tests/         数值性质、性能与浏览器交互验证
flake.nix       Nix 开发工具链
```

Worker 对更新请求合并处理，忽略过期结果；主线程可以继续响应操作。默认 16 电极/8 层适合交互，32 电极/14 层为高精度模式，耗时由硬件与浏览器决定；界面报告实际求解时间。当前不需要 Rust 后端。若扩展到 3D、复导纳完整电极模型或上百电极，可保留 Worker 协议，将求解核心替换为 Rust/WASM。

## 经典重建算法

四种方法共用同一组参考 Jacobian 与带噪测量，算法切换不改变噪声样本。不包含神经网络。所有输出都是均匀参考上的线性化差分重建；不等同于非线性绝对成像。

记 `x=Δσ`、`s=max diag(JᵀJ)`、`G=JᵀJ/s`、`b=Jᵀy/s`。

| 方法                  | 优化或构造                             | 专属控件                      | 适合的先验                     |
| --------------------- | -------------------------------------- | ----------------------------- | ------------------------------ |
| Tikhonov              | `(G+λI)x=b`，Cholesky 直接求解         | λ                             | 分散的、较平滑的变化；比较基线 |
| GREIT（线性训练实现） | 最小化训练目标的均方误差并惩罚噪声放大 | λ、小圆训练半径、期望高斯宽度 | 可控空间响应与快速重复应用     |
| TV / ADMM             | `min ½‖Jx−y‖²/s + α‖Bx‖₁`              | λ、ρ、迭代上限、容差          | 分段常数、较清晰的区域边界     |
| L1 / FISTA            | `min ½‖Jx−y‖²/s + α‖x‖₁`               | λ、迭代上限、容差             | 像素域稀疏、局部的电导率变化   |

TV 和 L1 取 `α=λ‖b‖∞`，因此 λ 相对于数据驱动的梯度尺度，而 Tikhonov 相对于灵敏度尺度。**不同算法的相同 λ 不能视为相同噪声性能。** L1 的 λ=1 对应零解；TV 的 λ=1 不必是零解，因为常数图像的 TV 为零。

### GREIT 的具体实现与限制

每个有效分区中心生成一个单位电导率变化小圆目标，组成 `T`；使用 `Y=JT` 得到小扰动线性化模拟测量。期望图像 `D` 是以相同中心生成的高斯核，按分区面积归一化，使每列与对应训练目标的积分一致。训练目标均匀加权，噪声协方差取单位矩阵；半径与高斯标准差使用原有归一化几何坐标。

```text
R = argmin_R ‖RY−D‖F² + β‖R‖F²
  = D(YᵀY+βI)⁻¹Yᵀ
β = λ × max diag(YᵀY)
x = Ry
```

通过目标空间的 Cholesky 求解构建 R，不显式求逆。改变几何、背景、频率、扫描方案会更新 J；改变训练半径、宽度或 λ 会更新训练算子。目标拖动、噪声或电流改变可复用 R。训练过程中**不读取当前目标位置、形状或真实电导率**。

这是 GREIT 目标训练框架下的浏览器实现，采用小扰动 Jacobian 训练与手动 β，未实现 EIDORS 完整非线性样本生成、Noise Figure 自动调参及全部 GREIT 品质指标。界面不会把 λ 标成 NF，也不宣称与 EIDORS 官方默认配置等价。

参考：[GREIT 原始算法论文](https://www.sce.carleton.ca/faculty/adler/publications/2009/GREIT-2009-algorithm.pdf)、[EIDORS GREIT 训练矩阵教程](https://eidors3d.sourceforge.net/tutorial/GREIT/mk_GREIT_matrix.shtml)。

### TV 与稀疏求解细节

TV 使用实际占据的笛卡尔分区之间的水平/垂直邻接差分 B，即各向异性图 TV；不连接对角线，不对域外补零。ADMM 更新为：

```text
(G + ρ BᵀB) x = b + ρ Bᵀ(z−u)
z = soft(Bx+u, α/ρ)
u = u + Bx−z
```

ρ 只影响收敛速度，不改变优化目标。原始/对偶残差同时满足绝对+相对容差条件后停止；界面显示两类残差与各自阈值之比的最大值（≤1 代表收敛）。

L1 使用有符号软阈值与 FISTA 加速。步长取 `1/L`，`L=max row-sum(abs(G))` 是安全谱上界。停止判据为 LASSO KKT 残差的无穷范数除以 `‖b‖∞`；界面显示该值。像素域是此处的稀疏基，未实现小波基或重加权 L1。EIT 灵敏度高度相关，不保证压缩感知理论的 RIP 或精确稀疏恢复条件成立。

迭代上限 20–1000，容差 1e-5–1e-2；达到上限时仍可查看当前迭代图像，但明确标记“未收敛”。无正值投影，允许高/低电导变化同时存在。

参考：[Boyd 等 ADMM](https://stanford.edu/~boyd/papers/admm_distr_stats.html)、[TV 的 ADMM 算法](https://web.stanford.edu/~boyd/papers/pdf/admm_tv_est.pdf)、[Beck–Teboulle FISTA](https://cris.tau.ac.il/en/publications/a-fast-iterative-shrinkage-thresholding-algorithm-for-linear-inve/)。

### 验证

`npm test` 包含：L1 有符号软阈值解析解、两分区 TV 解析解、GREIT 小矩阵闭式结果与缓存失效、边界图邻接、均匀介质零差分、电流缩放不变性、低对比度目标优于均匀先验、非收敛提示、多几何适配、v1/v2 文件迁移与非法参数拒绝。另有原有的互易性、能量守恒、正向残差与噪声复现测试。

`npm run test:ui` 验证四种算法切换、专属参数、训练缓存、导入导出、非收敛状态以及桌面/窄屏布局。

## 已测性能

本机 Apple Silicon、Nix Node.js 22，默认参数、10 次改变目标位置。耗时包含整轮正向模拟与重建，不含 Canvas 绘制及线程传输；每个算法的首次运行均使用新参考：

| 电极 / 网格层 | 算法     | 首次总耗时 | 缓存后中位数 | P90    |
| ------------- | -------- | ---------- | ------------ | ------ |
| 16 / 8 | Tikhonov | 36 ms | 11 ms | 11 ms |
| 16 / 8 | GREIT | 61 ms | 10 ms | 10 ms |
| 16 / 8 | TV | 36 ms | 14 ms | 23 ms |
| 16 / 8 | L1/FISTA | 51 ms | 25 ms | 26 ms |
| 32 / 14 | Tikhonov | 361 ms | 136 ms | 141 ms |
| 32 / 14 | GREIT | 429 ms | 132 ms | 135 ms |
| 32 / 14 | TV | 348 ms | 135 ms | 139 ms |
| 32 / 14 | L1/FISTA | 360 ms | 150 ms | 152 ms |

默认 FISTA 上述测量达到 250 次上限，尚未满足 1e-3 KKT 容差；其耗时不是完全收敛耗时。TV 首次分别为 31 / 10 次迭代。不同先验、λ 和容差决定了质量与速度，不应仅根据这张表判断算法优劣。以上是单机基准，不是跨设备性能保证；界面报告实际耗时和收敛状态。
