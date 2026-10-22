export type Point = [number, number];
export interface Inclusion {
  x: number;
  y: number;
  radius: number;
  sigma: number;
}
export interface Config {
  shape: "circle" | "ellipse" | "thorax" | "polygon";
  aspect: number;
  vertices: Point[];
  electrodes: number;
  rotation: number;
  rings: number;
  scheme: "adjacent" | "opposite" | "skip";
  skip: number;
  frequency: number;
  current: number;
  background: number;
  dispersion: number;
  corner: number;
  noise: number;
  lambda: number;
  inclusions: Inclusion[];
  seed: number;
}
export const defaults: Config = {
  shape: "circle",
  aspect: 0.76,
  vertices: [
    [-0.8, -0.7],
    [0.65, -0.8],
    [0.92, 0.2],
    [0.3, 0.85],
    [-0.8, 0.6],
  ],
  electrodes: 16,
  rotation: 0,
  rings: 8,
  scheme: "adjacent",
  skip: 3,
  frequency: 50,
  current: 1,
  background: 1,
  dispersion: 0.3,
  corner: 50,
  noise: 0.1,
  lambda: 0.01,
  seed: 42,
  inclusions: [
    { x: -0.32, y: -0.22, radius: 0.23, sigma: 1.8 },
    { x: 0.33, y: 0.3, radius: 0.19, sigma: 0.45 },
  ],
};
export interface Tri {
  ids: [number, number, number];
  area: number;
  gx: number[];
  gy: number[];
  x: number;
  y: number;
  bin: number;
}
export interface Mesh {
  points: Point[];
  triangles: Tri[];
  electrodes: number[];
  boundary: Point[];
  bins: number;
  binCenters: Point[];
}
export function validate(c: Config) {
  const ranges: [keyof Config, number, number][] = [
    ["electrodes", 8, 32],
    ["rings", 4, 14],
    ["rotation", 0, 359],
    ["aspect", 0.45, 1.4],
    ["skip", 2, 15],
    ["frequency", 1, 1000],
    ["current", 0.1, 10],
    ["background", 0.1, 3],
    ["dispersion", 0, 2],
    ["corner", 1, 500],
    ["noise", 0, 5],
    ["lambda", 0.00001, 1],
    ["seed", 0, 4294967295],
  ];
  for (const [key, min, max] of ranges)
    if (
      typeof c[key] !== "number" ||
      !Number.isFinite(c[key]) ||
      (c[key] as number) < min ||
      (c[key] as number) > max
    )
      throw new Error(`参数 ${key} 超出范围 ${min}–${max}`);
  if (
    ![8, 12, 16, 24, 32].includes(c.electrodes) ||
    !Number.isInteger(c.rings) ||
    !Number.isInteger(c.skip)
  )
    throw new Error("电极数或网格参数无效");
  if (
    !["circle", "ellipse", "thorax", "polygon"].includes(c.shape) ||
    !["adjacent", "opposite", "skip"].includes(c.scheme)
  )
    throw new Error("未知边界或扫描方案");
  if (!Array.isArray(c.inclusions) || c.inclusions.length > 8)
    throw new Error("最多支持 8 个目标");
  for (const i of c.inclusions)
    if (
      ![i.x, i.y, i.radius, i.sigma].every(Number.isFinite) ||
      Math.abs(i.x) > 0.95 ||
      Math.abs(i.y) > 0.95 ||
      i.radius < 0.06 ||
      i.radius > 0.5 ||
      i.sigma < 0.1 ||
      i.sigma > 4
    )
      throw new Error("目标参数无效");
  if (
    !Array.isArray(c.vertices) ||
    c.vertices.length < 3 ||
    c.vertices.length > 32
  )
    throw new Error("边界需要 3–32 个顶点");
  for (const p of c.vertices)
    if (
      !Array.isArray(p) ||
      p.length !== 2 ||
      !p.every(Number.isFinite) ||
      Math.max(...p.map(Math.abs)) > 1
    )
      throw new Error("顶点坐标必须位于 [-1, 1]");
  if (c.shape === "polygon") {
    let angleSum = 0;
    for (let k = 0; k < c.vertices.length; k++) {
      const a = c.vertices[k],
        b = c.vertices[(k + 1) % c.vertices.length];
      const cross = a[0] * b[1] - a[1] * b[0];
      if (cross < 0.015)
        throw new Error("顶点须围绕原点逆时针排列，每条边与原点保持距离");
      angleSum += Math.atan2(cross, a[0] * b[0] + a[1] * b[1]);
    }
    if (Math.abs(angleSum - 2 * Math.PI) > 1e-6)
      throw new Error("边界不可自交，且必须包含原点");
  }
}
export function boundaryAt(c: Config, t: number): Point {
  const x = Math.cos(t),
    y = Math.sin(t);
  if (c.shape === "ellipse") return [x * 0.92, y * 0.92 * c.aspect];
  if (c.shape === "thorax") {
    const r = 0.84 * (1 + 0.13 * Math.cos(2 * t) - 0.07 * Math.cos(4 * t));
    return [r * x, r * y * 0.85];
  }
  if (c.shape === "polygon") {
    for (let k = 0; k < c.vertices.length; k++) {
      const a = c.vertices[k],
        b = c.vertices[(k + 1) % c.vertices.length],
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      const det = x * dy - y * dx;
      if (Math.abs(det) < 1e-10) continue;
      const r = (a[0] * dy - a[1] * dx) / det,
        u = (a[0] * y - a[1] * x) / det;
      if (r > 0 && u >= -1e-8 && u <= 1 + 1e-8) return [r * x, r * y];
    }
    throw new Error("无法生成边界");
  }
  return [0.9 * x, 0.9 * y];
}
export function makeMesh(c: Config): Mesh {
  validate(c);
  const sectors = c.electrodes * 3,
    points: Point[] = [[0, 0]],
    boundary: Point[] = [];
  // Include polygon corners so every edge is represented exactly.
  const offset = (c.rotation * Math.PI) / 180;
  const angles = Array.from(
    { length: sectors },
    (_, k) => ((k / sectors) * 2 * Math.PI + offset) % (2 * Math.PI),
  );
  if (c.shape === "polygon")
    for (const p of c.vertices)
      angles.push((Math.atan2(p[1], p[0]) + 2 * Math.PI) % (2 * Math.PI));
  angles.sort((a, b) => a - b);
  const aa = angles.filter((a, k) => !k || a - angles[k - 1] > 1e-8),
    n = aa.length;
  for (const t of aa) boundary.push(boundaryAt(c, t));
  for (let r = 1; r <= c.rings; r++)
    for (const p of boundary)
      points.push([(p[0] * r) / c.rings, (p[1] * r) / c.rings]);
  const idx = (r: number, k: number) =>
    r === 0 ? 0 : 1 + (r - 1) * n + (k % n);
  const triangles: Tri[] = [],
    bins = new Map<string, number>(),
    sums: number[][] = [];
  function add(ids: [number, number, number]) {
    const [a, b, d] = ids.map((i) => points[i]);
    const twice = (b[0] - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (b[1] - a[1]);
    if (twice < 1e-12)
      throw new Error("网格包含退化三角形，请调整边界或电极旋转");
    const x = (a[0] + b[0] + d[0]) / 3,
      y = (a[1] + b[1] + d[1]) / 3,
      key = `${Math.floor((x + 1) * 8)},${Math.floor((y + 1) * 8)}`;
    if (!bins.has(key)) {
      bins.set(key, bins.size);
      sums.push([0, 0, 0]);
    }
    const bin = bins.get(key)!;
    sums[bin][0] += x * twice;
    sums[bin][1] += y * twice;
    sums[bin][2] += twice;
    triangles.push({
      ids,
      area: twice / 2,
      gx: [b[1] - d[1], d[1] - a[1], a[1] - b[1]].map((v) => v / twice),
      gy: [d[0] - b[0], a[0] - d[0], b[0] - a[0]].map((v) => v / twice),
      x,
      y,
      bin,
    });
  }
  for (let k = 0; k < n; k++) add([0, idx(1, k), idx(1, k + 1)]);
  for (let r = 2; r <= c.rings; r++)
    for (let k = 0; k < n; k++) {
      add([idx(r - 1, k), idx(r, k), idx(r, k + 1)]);
      add([idx(r - 1, k), idx(r, k + 1), idx(r - 1, k + 1)]);
    }
  const electrodes = Array.from({ length: c.electrodes }, (_, k) => {
    const t = ((k / c.electrodes) * 2 * Math.PI + offset) % (2 * Math.PI);
    let best = 0;
    aa.forEach((a, i) => {
      if (Math.abs(a - t) < Math.abs(aa[best] - t)) best = i;
    });
    return idx(c.rings, best);
  });
  return {
    points,
    triangles,
    electrodes,
    boundary,
    bins: bins.size,
    binCenters: sums.map((s) => [s[0] / s[2], s[1] / s[2]]),
  };
}
interface Matrix {
  row: Int32Array;
  col: Int32Array;
  val: Float64Array;
  diag: Float64Array;
}
export function assemble(mesh: Mesh, sigma: Float64Array): Matrix {
  const n = mesh.points.length,
    rows = Array.from({ length: n }, () => new Map<number, number>());
  mesh.triangles.forEach((t, k) => {
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++) {
        const i = t.ids[a],
          j = t.ids[b];
        if (i === 0 || j === 0) continue;
        rows[i].set(
          j,
          (rows[i].get(j) || 0) +
            sigma[k] * t.area * (t.gx[a] * t.gx[b] + t.gy[a] * t.gy[b]),
        );
      }
  });
  rows[0].set(0, 1);
  const row = new Int32Array(n + 1),
    col: number[] = [],
    val: number[] = [],
    diag = new Float64Array(n);
  rows.forEach((r, i) => {
    row[i] = col.length;
    r.forEach((v, j) => {
      col.push(j);
      val.push(v);
      if (i === j) diag[i] = v;
    });
  });
  row[n] = col.length;
  return { row, col: Int32Array.from(col), val: Float64Array.from(val), diag };
}
function dot(a: Float64Array, b: Float64Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
export function solve(A: Matrix, b: Float64Array) {
  const n = b.length,
    x = new Float64Array(n),
    r = b.slice(),
    z = new Float64Array(n),
    p = new Float64Array(n),
    ap = new Float64Array(n);
  for (let i = 0; i < n; i++) p[i] = z[i] = r[i] / A.diag[i];
  let rz = dot(r, z),
    iterations = 0;
  const norm = dot(b, b),
    tolerance = norm * 1e-18;
  for (
    ;
    iterations < Math.min(3000, n * 3) && dot(r, r) > tolerance;
    iterations++
  ) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = A.row[i]; k < A.row[i + 1]; k++) s += A.val[k] * p[A.col[k]];
      ap[i] = s;
    }
    const alpha = rz / dot(p, ap);
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * ap[i];
      z[i] = r[i] / A.diag[i];
    }
    const next = dot(r, z),
      beta = next / rz;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    rz = next;
  }
  const residual = Math.sqrt(dot(r, r) / (norm || 1));
  if (!Number.isFinite(residual) || residual > 1e-6)
    throw new Error(`正向求解未收敛 (${residual.toExponential(1)})`);
  return { x, residual, iterations };
}
export function rhs(mesh: Mesh, a: number, b: number) {
  const v = new Float64Array(mesh.points.length);
  v[mesh.electrodes[a]] = 1;
  v[mesh.electrodes[b]] = -1;
  v[0] = 0;
  return v;
}
export function drivePairs(c: Config): [number, number][] {
  const gap =
    c.scheme === "adjacent"
      ? 1
      : c.scheme === "opposite"
        ? c.electrodes / 2
        : Math.min(c.skip, c.electrodes - 1);
  return Array.from({ length: c.electrodes }, (_, k) => [
    k,
    (k + gap) % c.electrodes,
  ]);
}
export function dispersion(c: Config) {
  const q = (c.frequency / c.corner) ** 2;
  return 1 + (c.dispersion * q) / (1 + q);
}
export function conductivity(c: Config, m: Mesh) {
  const f = dispersion(c);
  return Float64Array.from(m.triangles, (t) => {
    let s = c.background;
    for (const i of c.inclusions)
      if (Math.hypot(t.x - i.x, t.y - i.y) < i.radius) s = i.sigma;
    return s * f;
  });
}
interface Cache {
  key: string;
  mesh: Mesh;
  pairs: [number, number][];
  measurements: [number, number, number][];
  fields: Float64Array[];
  baseline: Float64Array;
  J: Float64Array;
  baseSigma: number;
}
let cache: Cache | undefined;
function prepare(c: Config): Cache {
  const key = JSON.stringify([
    c.shape,
    c.aspect,
    c.vertices,
    c.electrodes,
    c.rotation,
    c.rings,
    c.scheme,
    c.skip,
    c.background,
    c.frequency,
    c.dispersion,
    c.corner,
  ]);
  if (cache?.key === key) return cache;
  const mesh = makeMesh(c),
    baseSigma = c.background * dispersion(c),
    A = assemble(mesh, new Float64Array(mesh.triangles.length).fill(baseSigma)),
    pairs = drivePairs(c);
  const fields = pairs.map(([a, b]) => solve(A, rhs(mesh, a, b)).x);
  const adj = Array.from(
    { length: c.electrodes },
    (_, a) => solve(A, rhs(mesh, a, (a + 1) % c.electrodes)).x,
  );
  const measurements: [number, number, number][] = [],
    baseline: number[] = [],
    rows: number[] = [];
  pairs.forEach(([a, b], d) => {
    for (let j = 0; j < c.electrodes; j++) {
      const k = (j + 1) % c.electrodes;
      if ([a, b].includes(j) || [a, b].includes(k)) continue;
      measurements.push([d, j, k]);
      baseline.push(
        fields[d][mesh.electrodes[j]] - fields[d][mesh.electrodes[k]],
      );
      const row = new Float64Array(mesh.bins);
      for (const t of mesh.triangles) {
        let ux = 0,
          uy = 0,
          vx = 0,
          vy = 0;
        for (let q = 0; q < 3; q++) {
          ux += t.gx[q] * fields[d][t.ids[q]];
          uy += t.gy[q] * fields[d][t.ids[q]];
          vx += t.gx[q] * adj[j][t.ids[q]];
          vy += t.gy[q] * adj[j][t.ids[q]];
        }
        row[t.bin] -= t.area * (ux * vx + uy * vy);
      }
      rows.push(...row);
    }
  });
  cache = {
    key,
    mesh,
    pairs,
    fields,
    measurements,
    baseline: Float64Array.from(baseline),
    J: Float64Array.from(rows),
    baseSigma,
  };
  return cache;
}
function reconstruct(
  J: Float64Array,
  y: Float64Array,
  p: number,
  lambda: number,
) {
  const m = y.length,
    diag = new Float64Array(p),
    b = new Float64Array(p),
    tmp = new Float64Array(m);
  for (let i = 0; i < m; i++)
    for (let j = 0; j < p; j++) {
      const v = J[i * p + j];
      diag[j] += v * v;
      b[j] += v * y[i];
    }
  const ridge = lambda * Math.max(...diag),
    x = new Float64Array(p),
    r = b.slice(),
    z = new Float64Array(p),
    d = new Float64Array(p),
    ad = new Float64Array(p);
  for (let j = 0; j < p; j++) d[j] = z[j] = r[j] / (diag[j] + ridge);
  let rz = dot(r, z),
    iter = 0;
  const norm = dot(b, b);
  for (; iter < 120 && dot(r, r) > norm * 1e-10 && norm > 1e-30; iter++) {
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let j = 0; j < p; j++) s += J[i * p + j] * d[j];
      tmp[i] = s;
    }
    for (let j = 0; j < p; j++) ad[j] = ridge * d[j];
    for (let i = 0; i < m; i++)
      for (let j = 0; j < p; j++) ad[j] += J[i * p + j] * tmp[i];
    const alpha = rz / dot(d, ad);
    for (let j = 0; j < p; j++) {
      x[j] += alpha * d[j];
      r[j] -= alpha * ad[j];
      z[j] = r[j] / (diag[j] + ridge);
    }
    const next = dot(r, z);
    for (let j = 0; j < p; j++) d[j] = z[j] + (next / rz) * d[j];
    rz = next;
  }
  let err = 0;
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < p; j++) s += J[i * p + j] * x[j];
    err += (s - y[i]) ** 2;
  }
  return { x, fit: Math.sqrt(err / (dot(y, y) || 1)), iterations: iter };
}
export function simulate(c: Config) {
  validate(c);
  const start = performance.now(),
    old = cache;
  const ref = prepare(c),
    prepared = performance.now(),
    { mesh, pairs, measurements, baseline, J } = ref;
  const sigma = conductivity(c, mesh),
    A = assemble(mesh, sigma),
    solutions = pairs.map(([a, b]) => solve(A, rhs(mesh, a, b))),
    fields = solutions.map((s) => s.x);
  // Sheet thickness 0.1 m; mA -> A. Unit-current fields have sheet conductance omitted.
  const scale = (c.current * 0.001) / 0.1,
    clean = Float64Array.from(
      measurements,
      ([d, a, b]) =>
        fields[d][mesh.electrodes[a]] - fields[d][mesh.electrodes[b]],
    );
  let seed = c.seed >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed + 0.5) / 4294967296;
  };
  const rms = Math.sqrt(dot(baseline, baseline) / baseline.length),
    noise = (c.noise / 100) * rms;
  const measured = Float64Array.from(
    clean,
    (v) =>
      v +
      noise *
        Math.sqrt(-2 * Math.log(random())) *
        Math.cos(2 * Math.PI * random()),
  );
  const delta = Float64Array.from(measured, (v, i) => v - baseline[i]),
    forward = performance.now(),
    inv = reconstruct(J, delta, mesh.bins, c.lambda),
    end = performance.now();
  const reconstructed = Float64Array.from(
    mesh.triangles,
    (t) => ref.baseSigma + inv.x[t.bin],
  );
  let err = 0,
    area = 0;
  mesh.triangles.forEach((t, i) => {
    err += t.area * (reconstructed[i] - sigma[i]) ** 2;
    area += t.area;
  });
  return {
    mesh,
    pairs,
    measurements,
    sigma,
    reconstructed,
    fields: fields.map((f) => Float64Array.from(f, (v) => v * scale)),
    baseline: Float64Array.from(baseline, (v) => v * scale),
    measured: Float64Array.from(measured, (v) => v * scale),
    delta: Float64Array.from(delta, (v) => v * scale),
    timing: {
      total: end - start,
      prepare: prepared - start,
      forward: forward - prepared,
      inverse: end - forward,
      cached: old === ref,
    },
    rmse: Math.sqrt(err / area),
    fit: inv.fit,
    residual: Math.max(...solutions.map((s) => s.residual)),
    inverseIterations: inv.iterations,
    baseSigma: ref.baseSigma,
  };
}
export type Result = ReturnType<typeof simulate>;
