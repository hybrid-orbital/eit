import { type Algorithm } from "../src/reconstruction";
import { defaults, simulate } from "../src/solver";
for (const [electrodes, rings] of [
  [16, 8],
  [32, 14],
]) {
  for (const algorithm of [
    "tikhonov",
    "greit",
    "tv",
    "sparse",
  ] as Algorithm[]) {
    // Force a new reference identity so each algorithm reports a genuine cold run.
    simulate({ ...structuredClone(defaults), electrodes: 8, rings: 4 });
    const c = { ...structuredClone(defaults), electrodes, rings, algorithm };
    const cold = simulate(c),
      samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      c.inclusions[0].x += 0.005;
      samples.push(simulate(c).timing.total);
    }
    samples.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        algorithm,
        electrodes,
        rings,
        nodes: cold.mesh.points.length,
        elements: cold.mesh.triangles.length,
        rmse: Number(cold.rmse.toFixed(4)),
        converged: cold.inverse.converged,
        iterations: cold.inverseIterations,
        cold_inverse_ms: Math.round(cold.timing.inverse),
        cold_ms: Math.round(cold.timing.total),
        warm_median_ms: Math.round((samples[4] + samples[5]) / 2),
        warm_p90_ms: Math.round(samples[8]),
      }),
    );
  }
}
