/** Classical linearized difference-EIT reconstruction, independent of phantom truth. */
export type Algorithm = "tikhonov" | "greit" | "tv" | "sparse";
export interface ReconstructionOptions {
  algorithm: Algorithm;
  lambda: number;
  iterations: number;
  tolerance: number;
  tvRho: number;
  greitRadius: number;
  greitWidth: number;
}
export const reconstructionDefaults: ReconstructionOptions = {
  algorithm: "tikhonov",
  lambda: 0.01,
  iterations: 250,
  tolerance: 0.001,
  tvRho: 0.02,
  greitRadius: 0.12,
  greitWidth: 0.16,
};
export const algorithmLabels: Record<Algorithm, string> = {
  tikhonov: "Tikhonov · L2",
  greit: "GREIT · 线性训练",
  tv: "全变分 TV · ADMM",
  sparse: "稀疏 L1 · FISTA",
};
export const algorithmDescriptions: Record<Algorithm, string> = {
  tikhonov: "L2 正则化基线，偏向平滑、分散的变化。λ 相对于 JᵀJ 的最大对角元。",
  greit:
    "用模拟小圆目标与期望高斯图像训练线性重建矩阵。缓存后直接应用；λ 控制训练噪声权重，不是 EIDORS 噪声系数 NF。",
  tv: "惩罚相邻分区的电导率差，保留分段常数与清晰边界。采用各向异性图 TV；λ 相对于 ‖Jᵀy‖∞。",
  sparse:
    "压缩感知中的 L1 稀疏先验，假设变化只占少量像素分区。FISTA 求解 LASSO；并非所有 EIT 扫描都满足压缩感知恢复条件。λ=1 时零解。",
};
export interface InverseGeometry {
  centers: [number, number][];
  areas: Float64Array;
}
export interface InverseResult {
  x: Float64Array;
  fit: number;
  iterations: number;
  converged: boolean;
  optimality: number;
  objective: number;
  operatorCached: boolean;
  trainingTargets: number;
}
function dot(a: Float64Array, b: Float64Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function norm(a: Float64Array) {
  return Math.sqrt(dot(a, a));
}
function maxAbs(a: Float64Array) {
  let s = 0;
  for (const v of a) s = Math.max(s, Math.abs(v));
  return s;
}
function mv(a: Float64Array, x: Float64Array, rows = x.length) {
  const out = new Float64Array(rows),
    n = x.length;
  for (let i = 0; i < rows; i++) {
    let v = 0;
    for (let j = 0; j < n; j++) v += a[i * n + j] * x[j];
    out[i] = v;
  }
  return out;
}
function transposeMv(a: Float64Array, x: Float64Array, n: number) {
  const out = new Float64Array(n);
  for (let i = 0; i < x.length; i++)
    for (let j = 0; j < n; j++) out[j] += a[i * n + j] * x[i];
  return out;
}
export function softThreshold(v: number, t: number) {
  return Math.abs(v) <= t ? 0 : Math.sign(v) * (Math.abs(v) - t);
}
/** Lower triangular Cholesky. Every use has a positive regularizer or connected TV graph. */
function cholesky(a: Float64Array, n: number) {
  const l = new Float64Array(n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = a[i * n + j];
      for (let k = 0; k < j; k++) s -= l[i * n + k] * l[j * n + k];
      if (i === j) {
        if (!(s > 0)) throw new Error("重建矩阵非正定，请增加正则化");
        l[i * n + j] = Math.sqrt(s);
      } else l[i * n + j] = s / l[j * n + j];
    }
  return l;
}
function cholSolve(l: Float64Array, b: Float64Array) {
  const n = b.length,
    x = b.slice();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) x[i] -= l[i * n + j] * x[j];
    x[i] /= l[i * n + i];
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) x[i] -= l[j * n + i] * x[j];
    x[i] /= l[i * n + i];
  }
  return x;
}
/** Forward differences only across occupied Cartesian neighbours; no zero padding at boundary. */
export function gridEdges(centers: [number, number][]): [number, number][] {
  const cells = centers.map(([x, y]) => [
    Math.floor((x + 1) * 8),
    Math.floor((y + 1) * 8),
  ]);
  const lookup = new Map(cells.map(([x, y], i) => [`${x},${y}`, i]));
  const edges: [number, number][] = [];
  cells.forEach(([x, y], i) => {
    for (const key of [`${x + 1},${y}`, `${x},${y + 1}`]) {
      const j = lookup.get(key);
      if (j !== undefined) edges.push([i, j]);
    }
  });
  return edges;
}
function gradient(x: Float64Array, edges: [number, number][]) {
  return Float64Array.from(edges, ([i, j]) => x[j] - x[i]);
}
function divergence(z: Float64Array, edges: [number, number][], p: number) {
  const out = new Float64Array(p);
  edges.forEach(([i, j], k) => {
    out[i] -= z[k];
    out[j] += z[k];
  });
  return out;
}
interface Prepared {
  gram: Float64Array;
  scale: number;
  lipschitz: number;
  factors: Map<string, Float64Array>;
  training?: {
    key: string;
    Y: Float64Array;
    D: Float64Array;
    gram: Float64Array;
    maxDiag: number;
    operators: Map<string, Float64Array>;
  };
}
const cache = new WeakMap<Float64Array, Prepared>();
function remember(
  map: Map<string, Float64Array>,
  key: string,
  value: Float64Array,
) {
  if (map.size >= 4) map.delete(map.keys().next().value!);
  map.set(key, value);
  return value;
}
function prepare(J: Float64Array, m: number, p: number) {
  let out = cache.get(J);
  if (out) return out;
  const gram = new Float64Array(p * p);
  for (let i = 0; i < m; i++)
    for (let j = 0; j < p; j++) {
      const v = J[i * p + j];
      for (let k = 0; k <= j; k++) gram[j * p + k] += v * J[i * p + k];
    }
  let scale = 0;
  for (let j = 0; j < p; j++) scale = Math.max(scale, gram[j * p + j]);
  if (!(scale > 0)) throw new Error("灵敏度矩阵为空");
  let lipschitz = 0;
  for (let j = 0; j < p; j++)
    for (let k = 0; k <= j; k++) gram[k * p + j] = gram[j * p + k] /= scale;
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let k = 0; k < p; k++) s += Math.abs(gram[j * p + k]);
    lipschitz = Math.max(lipschitz, s);
  }
  out = { gram, scale, lipschitz, factors: new Map() };
  cache.set(J, out);
  return out;
}
function train(
  J: Float64Array,
  geometry: InverseGeometry,
  o: ReconstructionOptions,
  state: Prepared,
) {
  const p = geometry.centers.length,
    m = J.length / p,
    key = JSON.stringify([
      o.greitRadius,
      o.greitWidth,
      geometry.centers,
      Array.from(geometry.areas),
    ]);
  if (state.training?.key === key) return state.training;
  const T = new Float64Array(p * p),
    D = new Float64Array(p * p);
  for (let k = 0; k < p; k++) {
    let mass = 0,
      desiredMass = 0;
    for (let j = 0; j < p; j++) {
      const distance = Math.hypot(
        geometry.centers[j][0] - geometry.centers[k][0],
        geometry.centers[j][1] - geometry.centers[k][1],
      );
      T[j * p + k] = distance <= o.greitRadius ? 1 : 0;
      D[j * p + k] = Math.exp(-0.5 * (distance / o.greitWidth) ** 2);
      mass += T[j * p + k] * geometry.areas[j];
      desiredMass += D[j * p + k] * geometry.areas[j];
    }
    for (let j = 0; j < p; j++) D[j * p + k] *= mass / desiredMass;
  }
  // Synthetic small-contrast measurements Y=JT, not measurements of the current phantom.
  const Y = new Float64Array(m * p);
  for (let i = 0; i < m; i++)
    for (let j = 0; j < p; j++) {
      const v = J[i * p + j];
      for (let k = 0; k < p; k++) Y[i * p + k] += v * T[j * p + k];
    }
  const gram = new Float64Array(p * p);
  for (let i = 0; i < m; i++)
    for (let j = 0; j < p; j++)
      for (let k = 0; k <= j; k++)
        gram[j * p + k] += Y[i * p + j] * Y[i * p + k];
  let maxDiag = 0;
  for (let j = 0; j < p; j++) {
    maxDiag = Math.max(maxDiag, gram[j * p + j]);
    for (let k = 0; k < j; k++) gram[k * p + j] = gram[j * p + k];
  }
  return (state.training = { key, Y, D, gram, maxDiag, operators: new Map() });
}
export function reconstruct(
  J: Float64Array,
  y: Float64Array,
  geometry: InverseGeometry,
  o: ReconstructionOptions,
): InverseResult {
  const p = geometry.centers.length,
    m = y.length;
  if (!p || J.length !== p * m || geometry.areas.length !== p)
    throw new Error("重建矩阵维度不匹配");
  const state = prepare(J, m, p),
    { gram: G, scale, lipschitz: L } = state;
  const b = transposeMv(J, y, p);
  for (let j = 0; j < p; j++) b[j] /= scale;
  let x = new Float64Array(p),
    iterations = 0,
    converged = true,
    optimality = 0,
    operatorCached = false,
    trainingTargets = 0,
    penalty = 0;
  const ynorm = dot(y, y),
    alpha = o.lambda * maxAbs(b);
  if (ynorm > 1e-30) {
    if (o.algorithm === "greit") {
      const tr = train(J, geometry, o, state);
      trainingTargets = p;
      const key = String(o.lambda);
      let R = tr.operators.get(key);
      operatorCached = !!R;
      if (!R) {
        const A = tr.gram.slice();
        for (let j = 0; j < p; j++) A[j * p + j] += o.lambda * tr.maxDiag;
        const l = cholesky(A, p);
        R = new Float64Array(p * m);
        // R=D(YᵀY+αI)⁻¹Yᵀ = DYᵀ(YYᵀ+αI)⁻¹; solve on smaller target space.
        for (let j = 0; j < p; j++) {
          const row = cholSolve(l, tr.D.slice(j * p, (j + 1) * p)),
            out = mv(tr.Y, row, m);
          R.set(out, j * m);
        }
        remember(tr.operators, key, R);
      }
      x = mv(R, y, p);
      iterations = 1;
    } else if (o.algorithm === "tikhonov") {
      const key = `ridge:${o.lambda}`;
      let l = state.factors.get(key);
      operatorCached = !!l;
      if (!l) {
        const A = G.slice();
        for (let j = 0; j < p; j++) A[j * p + j] += o.lambda;
        l = remember(state.factors, key, cholesky(A, p));
      }
      x = cholSolve(l, b);
      iterations = 1;
      const r = mv(G, x);
      for (let j = 0; j < p; j++) r[j] += o.lambda * x[j] - b[j];
      optimality = norm(r) / Math.max(norm(b), 1e-30);
      converged = optimality <= o.tolerance;
      penalty = 0.5 * o.lambda * dot(x, x);
    } else if (o.algorithm === "sparse") {
      let z = x.slice(),
        t = 1;
      converged = false;
      for (let it = 0; it < o.iterations; it++) {
        const g = mv(G, z),
          prev = x;
        x = Float64Array.from(z, (v, j) =>
          softThreshold(v - (g[j] - b[j]) / L, alpha / L),
        );
        const nextT = (1 + Math.sqrt(1 + 4 * t * t)) / 2;
        z = Float64Array.from(
          x,
          (v, j) => v + ((t - 1) / nextT) * (v - prev[j]),
        );
        t = nextT;
        const gx = mv(G, x);
        let violation = 0;
        for (let j = 0; j < p; j++) {
          const v = gx[j] - b[j];
          violation = Math.max(
            violation,
            x[j] !== 0
              ? Math.abs(v + alpha * Math.sign(x[j]))
              : Math.max(0, Math.abs(v) - alpha),
          );
        }
        optimality = violation / Math.max(maxAbs(b), 1e-30);
        iterations = it + 1;
        if (optimality <= o.tolerance) {
          converged = true;
          break;
        }
      }
      penalty = alpha * x.reduce((s, v) => s + Math.abs(v), 0);
    } else if (o.algorithm === "tv") {
      const edges = gridEdges(geometry.centers),
        rho = o.tvRho;
      const key = `tv:${rho}:${JSON.stringify(edges)}`;
      let l = state.factors.get(key);
      operatorCached = !!l;
      if (!l) {
        const A = G.slice();
        for (const [i, j] of edges) {
          A[i * p + i] += rho;
          A[j * p + j] += rho;
          A[i * p + j] -= rho;
          A[j * p + i] -= rho;
        }
        l = remember(state.factors, key, cholesky(A, p));
      }
      let z = new Float64Array(edges.length);
      const u = new Float64Array(edges.length);
      converged = false;
      for (let it = 0; it < o.iterations; it++) {
        const rhs = divergence(
          Float64Array.from(z, (v, k) => rho * (v - u[k])),
          edges,
          p,
        );
        for (let j = 0; j < p; j++) rhs[j] += b[j];
        x = cholSolve(l, rhs);
        const dx = gradient(x, edges),
          old = z;
        z = Float64Array.from(dx, (v, k) =>
          softThreshold(v + u[k], alpha / rho),
        );
        let primal = 0;
        for (let k = 0; k < z.length; k++) {
          const r = dx[k] - z[k];
          u[k] += r;
          primal += r * r;
        }
        const dual = norm(
          divergence(
            Float64Array.from(z, (v, k) => rho * (v - old[k])),
            edges,
            p,
          ),
        );
        const epsPrimal =
          o.tolerance * (Math.sqrt(edges.length) + Math.max(norm(dx), norm(z)));
        const epsDual =
          o.tolerance * (Math.sqrt(p) + rho * norm(divergence(u, edges, p)));
        optimality = Math.max(
          Math.sqrt(primal) / Math.max(epsPrimal, 1e-30),
          dual / epsDual,
        );
        iterations = it + 1;
        if (optimality <= 1) {
          converged = true;
          break;
        }
      }
      penalty = alpha * gradient(x, edges).reduce((s, v) => s + Math.abs(v), 0);
    } else throw new Error("未知重建算法");
  }
  const prediction = mv(J, x, m);
  let error = 0;
  for (let i = 0; i < m; i++) error += (prediction[i] - y[i]) ** 2;
  if (!x.every(Number.isFinite)) throw new Error("重建出现非有限数值");
  return {
    x,
    fit: Math.sqrt(error / (ynorm || 1)),
    iterations,
    converged,
    optimality,
    objective: (0.5 * error) / scale + penalty,
    operatorCached,
    trainingTargets,
  };
}
