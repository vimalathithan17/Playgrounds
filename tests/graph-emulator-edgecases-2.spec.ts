import { test, expect, Page } from "@playwright/test";

async function openGraph(page: Page) {
  await page.goto("/GraphBased.html");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => (window as any).__graphTest !== undefined);
  await page.evaluate(() => (window as any).__graphTest.reset());
}

async function run(page: Page, q: string, params?: any) {
  const res = await page.evaluate(
    ({ q, params }) => (window as any).__graphTest.run(q, params),
    { q, params }
  );
  if (!res.ok) throw new Error(res.error);
  return res;
}

async function runLines(page: Page, text: string, params?: any) {
  const res = await page.evaluate(
    ({ text, params }) => (window as any).__graphTest.runLines(text, params),
    { text, params }
  );
  for (const r of res) {
    if (!r.ok) throw new Error(r.error);
  }
  return res;
}

// Additional edge cases for Cypher parity

test.describe("Graph Emulator Edge Cases 2", () => {
  test("DISTINCT with aggregates and ORDER BY after WITH", async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:E2 {dept:'D1', v: 1})
      CREATE (:E2 {dept:'D1', v: 2})
      CREATE (:E2 {dept:'D2', v: 3})
      CREATE (:E2 {dept:'D2', v: 3})
    `);
    // WITH aggregates and DISTINCT downstream, plus ORDER BY
    const r = await run(page, "MATCH (e:E2) WITH e.dept AS d, COUNT(*) AS c RETURN DISTINCT d, c ORDER BY d");
    const rows = (r as any).data || [];
    expect(rows).toEqual([
      { d: 'D1', c: 2 },
      { d: 'D2', c: 2 },
    ]);
  });

  test("OPTIONAL MATCH across steps and COALESCE semantics", async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:P2 {id:1, name:'A'})
      CREATE (:P2 {id:2})
    `);
    const r = await run(page, `
      OPTIONAL MATCH (p:P2 {id:1})
      OPTIONAL MATCH (q:P2 {id:3})
      RETURN COALESCE(p.name, 'NA') AS pn, COALESCE(q.name, 'NA') AS qn ORDER BY pn, qn
    `);
    const rows = (r as any).data || [];
    expect(rows).toEqual([{ pn: 'A', qn: 'NA' }]);
  });

  test("Type alternation with variable length and direction", async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:TA {id:1})
      CREATE (:TB {id:2})
      CREATE (:TC {id:3})
      MATCH (a:TA {id:1}), (b:TB {id:2}) CREATE (a)-[:X]->(b)
      MATCH (b:TB {id:2}), (c:TC {id:3}) CREATE (b)-[:Y]->(c)
    `);
    // Directed 1..2 hops with alternation X|Y from a to c should match
    const r1 = await run(page, "MATCH (a:TA {id:1})-[:X|Y*1..2]->(c:TC {id:3}) RETURN COUNT(*) AS c");
    expect((r1 as any).data[0].c).toBe(1);
    // Reverse direction should not match
    const r2 = await run(page, "MATCH (c:TC {id:3})-[:X|Y*1..2]->(a:TA {id:1}) RETURN COUNT(*) AS c");
    expect((r2 as any).data[0].c).toBe(0);
  });
});
