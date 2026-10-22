import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  simulate,
  makeMesh,
  assemble,
  solve,
  rhs,
  validate,
  type Config,
} from "../src/solver";
const conf = (patch: Partial<Config> = {}): Config => ({
  ...structuredClone(defaults),
  noise: 0,
  ...patch,
});
test("homogeneous medium has zero difference and exact reconstruction", () => {
  const r = simulate(conf({ inclusions: [] }));
  assert.ok(Math.max(...r.delta.map(Math.abs)) < 1e-12);
  assert.ok(r.rmse < 1e-10);
  assert.equal(r.measured.length, 16 * 13);
  assert.ok(r.residual < 1e-8);
});
test("potential scales linearly with injected current; reconstruction is invariant", () => {
  const a = simulate(conf()),
    b = simulate(conf({ current: 2 }));
  a.measured.forEach((v, i) =>
    assert.ok(Math.abs(b.measured[i] - 2 * v) < 1e-12),
  );
  assert.ok(Math.abs(a.rmse - b.rmse) < 1e-12);
  assert.equal(b.timing.cached, true);
});
test("reciprocity and power conservation for FEM operator", () => {
  const m = makeMesh(conf()),
    A = assemble(m, new Float64Array(m.triangles.length).fill(1));
  const b = rhs(m, 0, 5),
    v = solve(A, b).x,
    w = solve(A, rhs(m, 8, 12)).x;
  assert.ok(
    Math.abs(
      v[m.electrodes[8]] -
        v[m.electrodes[12]] -
        (w[m.electrodes[0]] - w[m.electrodes[5]]),
    ) < 1e-8,
  );
  let energy = 0;
  for (const t of m.triangles) {
    let x = 0,
      y = 0;
    for (let j = 0; j < 3; j++) {
      x += t.gx[j] * v[t.ids[j]];
      y += t.gy[j] * v[t.ids[j]];
    }
    energy += t.area * (x * x + y * y);
  }
  assert.ok(
    Math.abs(energy - (v[m.electrodes[0]] - v[m.electrodes[5]])) < 1e-7,
  );
});
test("all geometries and protocols have valid meshes and finite solutions", () => {
  for (const shape of ["circle", "ellipse", "thorax", "polygon"] as const)
    for (const scheme of ["adjacent", "opposite", "skip"] as const) {
      const r = simulate(conf({ shape, scheme, electrodes: 8, rings: 4 }));
      assert.ok(r.mesh.triangles.every((t) => t.area > 0));
      assert.equal(new Set(r.mesh.electrodes).size, 8);
      assert.ok(r.reconstructed.every(Number.isFinite));
      assert.ok(r.residual < 1e-8);
    }
});
test("low contrast reconstruction improves over homogeneous prior", () => {
  const c = conf({
    inclusions: [{ x: 0.3, y: 0.2, radius: 0.25, sigma: 1.15 }],
    lambda: 0.0001,
  });
  const r = simulate(c);
  let err = 0,
    area = 0;
  r.mesh.triangles.forEach((t, i) => {
    err += t.area * (r.sigma[i] - r.baseSigma) ** 2;
    area += t.area;
  });
  assert.ok(
    r.rmse < Math.sqrt(err / area) * 0.85,
    `${r.rmse} vs ${Math.sqrt(err / area)}`,
  );
});
test("frequency dispersion changes voltages; fixed noise seed is reproducible", () => {
  const a = simulate(conf({ inclusions: [], frequency: 1 })),
    b = simulate(conf({ inclusions: [], frequency: 1000 }));
  assert.ok(Math.abs(b.measured[0]) < Math.abs(a.measured[0]));
  const c = simulate(conf({ noise: 1 })),
    d = simulate(conf({ noise: 1 }));
  assert.deepEqual(c.measured, d.measured);
  assert.notDeepEqual(
    c.measured,
    simulate(conf({ noise: 1, seed: 13 })).measured,
  );
});
test("reject malformed, self-intersecting and out-of-range inputs", () => {
  assert.throws(() => validate(conf({ electrodes: 0 })));
  assert.throws(() => validate(conf({ frequency: NaN })));
  assert.throws(() =>
    validate(
      conf({
        shape: "polygon",
        vertices: [
          [0.9, 0],
          [-0.9, 0],
          [0, 0.9],
        ],
      }),
    ),
  );
  assert.throws(() =>
    validate(conf({ inclusions: [{ x: 0, y: 0, radius: -1, sigma: 1 }] })),
  );
});
