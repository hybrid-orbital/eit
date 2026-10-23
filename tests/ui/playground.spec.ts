import { test, expect } from "@playwright/test";
test("simulation controls, import/export, drag, playback and responsive layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await expect(page.locator("#metric-meas")).toContainText("208");
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  const initial = await page.locator("#metric-rmse").textContent();
  await page.locator('[data-key="target.sigma"]').fill("2.5");
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await expect(page.locator("#metric-rmse")).not.toHaveText(initial!);
  await page.locator("#shape").selectOption("polygon");
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await expect(page.locator("#error")).toBeHidden();
  await page.locator("#vertices").fill("[[0,0]]");
  await page.locator("#apply-vertices").click();
  await expect(page.locator("#error")).toBeVisible();
  await page
    .locator("#vertices")
    .fill("[[-0.8,-0.7],[0.65,-0.8],[0.92,0.2],[0.3,0.85],[-0.8,0.6]]");
  await page.locator("#apply-vertices").click();
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await page.locator("#scheme").selectOption("opposite");
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await expect(page.locator("#metric-meas")).toContainText("192");
  await page.locator("#play").click();
  await expect(page.locator("#scan-count")).not.toHaveText("01 / 16");
  await page.locator("#play").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await downloadPromise;
  const path = await download.path();
  await page.locator("#reset").click();
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await page.locator("#file").setInputFiles(path!);
  await expect(page.locator("#shape")).toHaveValue("polygon");
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  const csvPromise = page.waitForEvent("download");
  await page.locator("#csv").click();
  expect((await csvPromise).suggestedFilename()).toBe("eit-measurements.csv");
  await page.locator("#reset").click();
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await page.locator("#truth").scrollIntoViewIfNeeded();
  const box = await page.locator("#truth").boundingBox();
  const s = Math.min(box!.width, box!.height) * 0.405;
  await page.mouse.move(
    box!.x + box!.width / 2 - 0.32 * s,
    box!.y + box!.height / 2 - 6 + 0.22 * s,
  );
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 - 0.1 * s,
    box!.y + box!.height / 2 - 6 + 0.15 * s,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await expect(page.locator('[data-key="target.x"]')).toHaveValue("-0.1");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("classical reconstruction switching, tuning, cache and versioned experiments", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  const truth = await page
    .locator("#truth")
    .evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const images = new Set<string>();
  for (const algorithm of ["tikhonov", "greit", "tv", "sparse"]) {
    await page.locator("#quick-algorithm").selectOption(algorithm);
    await expect(page.locator("#status")).toHaveText("仿真已同步");
    await expect(page.locator("#algorithm")).toHaveValue(algorithm);
    await expect(page.locator("#error")).toBeHidden();
    expect(
      await page.locator("#truth").evaluate((c: HTMLCanvasElement) => c.width),
    ).toBeGreaterThan(0);
    images.add(
      await page
        .locator("#recon")
        .evaluate((c: HTMLCanvasElement) => c.toDataURL()),
    );
  }
  expect(images.size).toBe(4);
  await page.locator("#algorithm").selectOption("greit");
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await page.locator('[data-key="greitWidth"]').fill("0.2");
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await expect(page.locator("#inverse-detail")).toContainText("本次构建算子");
  await page.locator('[data-key="target.x"]').fill("0.1");
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await expect(page.locator("#inverse-detail")).toContainText("算子缓存命中");
  await page.locator("#algorithm").selectOption("tv");
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await page.locator('[data-key="tvRho"]').fill("0.1");
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const path = await (await download).path();
  await page.locator("#reset").click();
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await page.locator("#file").setInputFiles(path!);
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await expect(page.locator("#quick-algorithm")).toHaveValue("tv");
  await expect(page.locator('[data-key="tvRho"]')).toHaveValue("0.1");
  await page.locator("#algorithm").selectOption("sparse");
  await page.locator('[data-key="iterations"]').fill("20");
  await page.locator('[data-key="tolerance"]').fill("-5");
  await page.locator('[data-key="lambda"]').fill("-5");
  await expect(page.locator("#status")).toHaveText("仿真已同步");
  await expect(page.locator("#inverse-status")).toContainText("未收敛");
  await page.screenshot({
    path: "test-results/algorithms-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/algorithms-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(truth.length).toBeGreaterThan(100);
});
