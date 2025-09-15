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

// Edge cases to mirror Cypher semantics precisely

test.describe("Graph Emulator Edge Cases", () => {
  test("COUNT(*) vs COUNT(prop) null handling", async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:E {a:1})
      CREATE (:E {a:null})
      CREATE (:E)
    `);
    const r1 = await run(page, "MATCH (n:E) RETURN COUNT(*) AS c");
    expect((r1 as any).data[0].c).toBe(3);
    const r2 = await run(page, "MATCH (n:E) RETURN COUNT(n.a) AS c");
    expect((r2 as any).data[0].c).toBe(1);
  });

  test("OPTIONAL MATCH with WHERE produces NULL row on no match", async ({ page }) => {
    await openGraph(page);
    const r = await run(page, "OPTIONAL MATCH (x:Nope) WHERE x.id = 1 RETURN x, x.id AS id");
    const rows = (r as any).data || [];
    expect(rows.length).toBe(1);
    expect(rows[0].x).toBeNull();
    expect(rows[0].id).toBeNull();
  });

  test("UNWIND empty list yields zero rows", async ({ page }) => {
    await openGraph(page);
    const r = await run(page, "UNWIND [] AS n RETURN n");
    expect(((r as any).data || []).length).toBe(0);
  });

  test("WHERE precedence AND over OR with parentheses respected", async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:W {a:1, b:1})
      CREATE (:W {a:1, b:2})
      CREATE (:W {a:2, b:1})
    `);
    // a = 1 AND (b = 1 OR b = 2) => two rows with a=1
    const r1 = await run(page, "MATCH (n:W) WHERE n.a = 1 AND (n.b = 1 OR n.b = 2) RETURN COUNT(*) AS c");
    expect((r1 as any).data[0].c).toBe(2);
    // (a = 1 AND b = 1) OR b = 2 => two rows (1,1) and (1,2)
    const r2 = await run(page, "MATCH (n:W) WHERE (n.a = 1 AND n.b = 1) OR n.b = 2 RETURN COUNT(*) AS c");
    expect((r2 as any).data[0].c).toBe(2);
  });

  test("Relationship alternation with property match", async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:A {id:1})
      CREATE (:B {id:2})
      MATCH (a:A {id:1}), (b:B {id:2}) CREATE (a)-[:R1 {k:1}]->(b)
    `);
    const r = await run(page, "MATCH (a:A)-[:R1|R2 {k:1}]->(b:B) RETURN COUNT(*) AS c");
    expect((r as any).data[0].c).toBe(1);
  });

  test("Regex anchors ^ $ and empty match behavior", async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:T {name:'Alice'})");
    const r1 = await run(page, "MATCH (t:T) WHERE t.name =~ '^Al.*' RETURN COUNT(*) AS c");
    expect((r1 as any).data[0].c).toBe(1);
    const r2 = await run(page, "MATCH (t:T) WHERE t.name =~ '.*ice$' RETURN COUNT(*) AS c");
    expect((r2 as any).data[0].c).toBe(1);
  });

  test("REMOVE no-op on missing properties/labels", async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:Z {id:1})");
    const r = await run(page, "MATCH (z:Z {id:1}) REMOVE z.missing, z:Nope RETURN z.id AS id");
    expect((r as any).data[0].id).toBe(1);
  });
});
