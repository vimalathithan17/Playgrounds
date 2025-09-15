import { test, expect } from "@playwright/test";

test.describe("Graph Emulator Canary", () => {
  test("__graphTest is ready and RETURN works", async ({ page }) => {
    await page.goto("/GraphBased.html");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => (window as any).__graphTest !== undefined);
    const r = await page.evaluate(() => (window as any).__graphTest.run("RETURN 1 AS x"));
    expect(r.ok).toBeTruthy();
    const data = (r as any).data || (r as any).result || [];
    expect(data.length).toBe(1);
    expect(data[0].x).toBe(1);
  });
});
