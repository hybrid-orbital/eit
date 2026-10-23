import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconstruct,
  reconstructionDefaults,
  gridEdges,
  type Algorithm,
  type InverseGeometry,
} from "../src/reconstruction";
import { simulate, defaults, validate, importExperiment } from "../src/solver";
const options = {
  ...reconstructionDefaults,
  iterations: 1000,
  tolerance: 1e-5,
};
const geometry: InverseGeometry = {
  centers: [
    [-0.0625, 0],
    [0.0625, 0],
  ],
  areas: new Float64Array([1, 1]),
};
const identity = new Float64Array([1, 0, 0, 1]);
const algorithms: Algorithm[] = ["tikhonov", "greit", "tv", "sparse"];
function close(a: number, b: number, eps = 1e-5) {
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
}
test("L1/FISTA agrees with analytic signed soft threshold and KKT condition", () => {
  const r = reconstruct(identity, new Float64Array([1, -0.4]), geometry, {
    ...options,
    algorithm: "sparse",
    lambda: 0.2,
  });
  close(r.x[0], 0.8);
  close(r.x[1], -0.2);
  assert.ok(r.converged);
  assert.ok(r.optimality < 1e-8);
  const zero = reconstruct(identity, new Float64Array([1, -0.4]), geometry, {
    ...options,
    algorithm: "sparse",
    lambda: 1,
  });
  assert.deepEqual(Array.from(zero.x), [0, 0]);
});
test("TV/ADMM agrees with analytic two-cell fused lasso solution", () => {
  const r = reconstruct(identity, new Float64Array([1, -1]), geometry, {
    ...options,
    algorithm: "tv",
    lambda: 0.1,
    tvRho: 0.2,
  });
  close(r.x[0], 0.9, 1e-4);
  close(r.x[1], -0.9, 1e-4);
  assert.ok(r.converged);
  const constant = reconstruct(
    identity,
    new Float64Array([0.5, 0.5]),
    geometry,
    { ...options, algorithm: "tv", lambda: 1 },
  );
  close(constant.x[0], 0.5);
  close(constant.x[1], 0.5);
});
test("GREIT training matrix matches closed-form identity case and invalidates by kernel width", () => {
  const y = new Float64Array([1, 0]),
    o = {
      ...options,
      algorithm: "greit" as const,
      lambda: 0.1,
      greitRadius: 0.06,
      greitWidth: 0.1,
    };
  const a = reconstruct(identity, y, geometry, o),
    w = Math.exp(-0.5 * (0.125 / 0.1) ** 2);
  close(a.x[0], 1 / (1 + w) / 1.1);
  close(a.x[1], w / (1 + w) / 1.1);
  assert.equal(a.trainingTargets, 2);
  const cached = reconstruct(identity, y, geometry, o);
  assert.equal(cached.operatorCached, true);
  assert.deepEqual(cached.x, a.x);
  const changed = reconstruct(identity, y, geometry, { ...o, greitWidth: 0.2 });
  assert.equal(changed.operatorCached, false);
  assert.notDeepEqual(changed.x, a.x);
  const regularized = reconstruct(identity, y, geometry, { ...o, lambda: 0.8 });
  assert.ok(regularized.x[0] < a.x[0]);
});
test("TV graph excludes diagonals, holes and outside-domain zero padding", () => {
  assert.deepEqual(
    gridEdges([
      [-0.0625, -0.0625],
      [0.0625, 0.0625],
      [0.1875, 0.0625],
    ]),
    [[1, 2]],
  );
});
test("all algorithms return exact zero for homogeneous data and preserve current scaling", () => {
  for (const algorithm of algorithms) {
    const uniform = simulate({
      ...structuredClone(defaults),
      algorithm,
      noise: 0,
      inclusions: [],
    });
    assert.ok(uniform.rmse < 1e-10);
    assert.ok(uniform.inverse.converged);
    const c = { ...structuredClone(defaults), algorithm, noise: 0 };
    const a = simulate(c),
      b = simulate({ ...c, current: 2 });
    assert.deepEqual(a.reconstructed, b.reconstructed);
  }
});
test("all methods improve a low contrast phantom over the uniform prior", () => {
  for (const algorithm of algorithms) {
    const c = {
      ...structuredClone(defaults),
      algorithm,
      noise: 0,
      lambda: 0.001,
      greitWidth: 0.1,
      iterations: 600,
      tolerance: 0.00001,
      inclusions: [{ x: 0.3, y: 0.2, radius: 0.25, sigma: 1.15 }],
    };
    const r = simulate(c);
    let error = 0,
      area = 0;
    r.mesh.triangles.forEach((t, i) => {
      error += t.area * (r.sigma[i] - r.baseSigma) ** 2;
      area += t.area;
    });
    const prior = Math.sqrt(error / area);
    assert.ok(r.rmse < prior, `${algorithm} ${r.rmse} >= ${prior}`);
  }
});
test("nonconvergence is reported honestly and custom geometries work for every method", () => {
  const c = {
    ...structuredClone(defaults),
    algorithm: "sparse" as const,
    iterations: 20,
    tolerance: 0.00001,
    lambda: 0.00001,
  };
  assert.equal(simulate(c).inverse.converged, false);
  for (const algorithm of algorithms)
    for (const shape of ["ellipse", "thorax", "polygon"] as const) {
      const r = simulate({
        ...structuredClone(defaults),
        algorithm,
        shape,
        electrodes: 8,
        rings: 4,
        noise: 1,
      });
      assert.ok(r.reconstructed.every(Number.isFinite));
    }
});
test("legacy JSON migration, new config round-trip and invalid algorithm settings", () => {
  const legacy = { ...structuredClone(defaults) } as Record<string, unknown>;
  for (const k of Object.keys(reconstructionDefaults))
    if (k !== "lambda") delete legacy[k];
  const imported = importExperiment({
    version: 1,
    config: legacy as unknown as typeof defaults,
  });
  assert.equal(imported.algorithm, "tikhonov");
  const current = {
    ...structuredClone(defaults),
    algorithm: "tv" as const,
    tvRho: 0.1,
  };
  assert.deepEqual(
    importExperiment(
      JSON.parse(JSON.stringify({ version: 2, config: current })),
    ),
    current,
  );
  assert.throws(() =>
    importExperiment({
      version: 2,
      config: legacy as unknown as typeof defaults,
    }),
  );
  assert.throws(() =>
    validate({ ...defaults, algorithm: "neural" as Algorithm }),
  );
  assert.throws(() => validate({ ...defaults, iterations: 20.5 }));
  assert.throws(() => validate({ ...defaults, tvRho: 0 }));
  assert.throws(() => validate({ ...defaults, greitWidth: NaN }));
});
