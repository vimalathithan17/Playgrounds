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

// Additional edge cases for strict Cypher parity

test.describe("Graph Emulator Edge Cases 3", () => {
  test("Variable-length zero-hop matches same node", async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:Z0 {id:1})");
    const r = await run(page, "MATCH (a:Z0 {id:1})-[:R*0..2]->(a) RETURN COUNT(*) AS c");
    expect((r as any).data[0].c).toBe(1);
  });

  test("Inbound direction single-hop matches", async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:TB {id:2})
      CREATE (:TC {id:3})
      MATCH (b:TB {id:2}), (c:TC {id:3}) CREATE (b)-[:Y]->(c)
    `);
    const r = await run(page, "MATCH (c:TC {id:3})<-[:Y]-(:TB {id:2}) RETURN COUNT(*) AS c");
    expect((r as any).data[0].c).toBe(1);
  });

  test("List predicates: null list yields no match in WHERE; ALL on [] is true", async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:LP {id:1})");
    // ANY over null -> treated as null => WHERE filters out row
    const r1 = await run(page, "MATCH (n:LP {id:1}) WHERE ANY(x IN n.missing WHERE x > 0) RETURN COUNT(*) AS c");
    expect((r1 as any).data[0].c).toBe(0);
    // Vacuous truth: ALL over [] is true, so row remains
    const r2 = await run(page, "MATCH (n:LP {id:1}) WHERE ALL(x IN [] WHERE x > 0) RETURN COUNT(*) AS c");
    expect((r2 as any).data[0].c).toBe(1);
  });

  test("COLLECT retains nulls, DISTINCT keeps one null", async ({ page }) => {
    await openGraph(page);
    const r = await run(page, "UNWIND [1, NULL, 1, NULL] AS x RETURN collect(x) AS c, collect(DISTINCT x) AS cd");
    const rows = (r as any).data || [];
    expect(rows.length).toBe(1);
    const c = rows[0].c;
    const cd = rows[0].cd;
    // c should include two 1s and two nulls (order may be preserved but we only check multiset counts)
    expect(Array.isArray(c)).toBe(true);
    expect(c.length).toBe(4);
    const ones = c.filter((v: any) => v === 1).length;
    const nulls = c.filter((v: any) => v === null).length;
    expect(ones).toBe(2);
    expect(nulls).toBe(2);
    // cd should contain exactly one 1 and one null (order not asserted)
    expect(Array.isArray(cd)).toBe(true);
    expect(cd.length).toBe(2);
    expect(cd.some((v: any) => v === 1)).toBe(true);
    expect(cd.some((v: any) => v === null)).toBe(true);
  });
});
