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
