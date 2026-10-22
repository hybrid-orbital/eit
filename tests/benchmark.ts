import { defaults, simulate } from "../src/solver";
for (const [electrodes, rings] of [
  [16, 8],
  [32, 14],
]) {
  const c = { ...structuredClone(defaults), electrodes, rings };
  const cold = simulate(c),
    samples: number[] = [];
  for (let i = 0; i < 10; i++) {
    c.inclusions[0].x += 0.005;
    samples.push(simulate(c).timing.total);
  }
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      electrodes,
      rings,
      nodes: cold.mesh.points.length,
      elements: cold.mesh.triangles.length,
      cold_ms: Math.round(cold.timing.total),
      warm_median_ms: Math.round(samples[5]),
      warm_p90_ms: Math.round(samples[9]),
    }),
  );
}
