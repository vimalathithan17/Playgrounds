import { test, expect, Page } from "@playwright/test";

async function openGraph(page: Page) {
  await page.goto("/GraphBased.html");
  await page.waitForLoadState("domcontentloaded");
  // Wait for test hook to be ready
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

async function snapshot(page: Page) {
  return page.evaluate(() => (window as any).__graphTest.getDbSnapshot());
}

// Contracts: ensures executor core commands and helpers work
// Edge cases covered: multi-label nodes, rel type alternation, direction, variable hops, SET/REMOVE, MERGE, UNWIND, constraints, indexes, CALL procs, path helpers, ORDER BY/SKIP/LIMIT

test.describe("Neo4j Emulator Smoke", () => {
  test("database management and HELP", async ({ page }) => {
    await openGraph(page);
    let r = await run(page, "HELP");
    expect(r.type).toBe("help");

    r = await run(page, "CREATE DATABASE demo");
    expect(r.message).toContain("created");
    r = await run(page, "USE demo");
    expect(r.message).toContain("Now using database 'demo'");
    r = await run(page, "DROP DATABASE demo");
    expect(r.message).toContain("dropped");
  });

  test("CREATE/MATCH basic nodes and relationships", async ({ page }) => {
    await openGraph(page);
    await runLines(
      page,
      `
      CREATE (a:Person {name: 'Alice', email: 'alice@example.com'})
      CREATE (b:Person:Employee {name: 'Bob', email: 'bob@example.com'})
      CREATE (c:Company {name: 'Acme'})
    `
    );
    let snap = await snapshot(page);
    expect(snap.nodes.length).toBe(3);

    // Relationship creation via MATCH + CREATE
    await runLines(
      page,
      `
      MATCH (a:Person {name: 'Alice'}), (b:Person {name: 'Bob'})
      CREATE (a)-[:KNOWS {since: 2020}]->(b)
      MATCH (b:Employee {name: 'Bob'}), (c:Company {name: 'Acme'})
      CREATE (b)-[:WORKS_FOR]->(c)
    `
    );
    snap = await snapshot(page);
    expect(snap.relationships.length).toBe(2);
  });

  test("MATCH with direction, alternation types, properties, variable hops", async ({
    page,
  }) => {
    await openGraph(page);
    await runLines(
      page,
      `
      CREATE (a:Person {name: 'A'})
      CREATE (b:Person {name: 'B'})
      CREATE (c:Person {name: 'C'})
      MATCH (a:Person {name: 'A'}), (b:Person {name: 'B'})
      CREATE (a)-[:R1]->(b)
      MATCH (b:Person {name: 'B'}), (c:Person {name: 'C'})
      CREATE (b)-[:R2]->(c)
    `
    );

    // Directed R1 only
    let res = await run(
      page,
      'MATCH (x:Person {name: "A"})-[:R1]->(y:Person) RETURN x,y'
    );
    expect(res.result.length).toBe(1);
    // Alternation R1|R2
    res = await run(page, "MATCH (x)-[:R1|R2]->(y) RETURN x,y");
    expect(res.result.length).toBe(2);
    // Variable hops 1..2
    res = await run(
      page,
      'MATCH p=(x:Person {name: "A"})-[*1..2]->(z) RETURN length(p) AS l'
    );
    expect(res.result.some((r: any) => r.l >= 1 && r.l <= 2)).toBeTruthy();
  });

  test("SET/REMOVE properties and labels", async ({ page }) => {
    await openGraph(page);
    await runLines(
      page,
      `
      CREATE (n:Node {v: 1})
      MATCH (n:Node {v: 1}) SET n.v = 2, n:Extra
      MATCH (n:Node {v: 2}) REMOVE n.v, n:Extra
    `
    );
    const s = await snapshot(page);
    const node = s.nodes.find((n: any) => n.labels.includes("Node"));
    expect(node.properties.v).toBeUndefined();
    expect(node.labels.includes("Extra")).toBeFalsy();
  });

  test("MERGE node and ON CREATE/ON MATCH", async ({ page }) => {
    await openGraph(page);
    let r = await run(
      page,
      "MERGE (u:User {id: 'u1'}) ON CREATE SET u.created = 1 ON MATCH SET u.visits = 1"
    );
    expect(r.message.toLowerCase()).toContain("created");
    r = await run(
      page,
      "MERGE (u:User {id: 'u1'}) ON CREATE SET u.created = 2 ON MATCH SET u.visits = 2"
    );
    expect(r.message.toLowerCase()).toContain("matched");
  });

  test("UNWIND and CREATE many", async ({ page }) => {
    await openGraph(page);
    await run(
      page,
      "UNWIND ['A','B','C'] AS title CREATE (:Doc {title: title})"
    );
    const s = await snapshot(page);
    expect(s.nodes.filter((n: any) => n.labels.includes("Doc")).length).toBe(3);
  });

  test("Constraints and Indexes", async ({ page }) => {
    await openGraph(page);
    await run(
      page,
      "CREATE CONSTRAINT employee_email_unique ON (e:Employee) ASSERT e.email IS UNIQUE"
    );
    await run(page, "CREATE INDEX ON :Employee(department)");
    const s = await snapshot(page);
    expect(s.constraints).toContain("Employee.email");
    expect(s.indexes).toContain("Employee.department");
  });

  test("Procedures CALL db.* and schema listing", async ({ page }) => {
    await openGraph(page);
    await runLines(
      page,
      `
      CREATE (:A {x: 1})
      CREATE (:B {y: 2})
      CREATE (:A {x: 3})
    `
    );
    let r = await run(page, "CALL db.labels()");
    expect(r.type).toBe("tabular");
    expect((r as any).columns).toContain("label");
    r = await run(page, "CALL db.propertyKeys()");
    expect((r as any).columns).toContain("propertyKey");
    r = await run(page, "CALL db.relationshipTypes()");
    expect((r as any).columns).toContain("relationshipType");
  });

  test("Path functions and canonical path object", async ({ page }) => {
    await openGraph(page);
    await runLines(
      page,
      `
      CREATE (a:Person {name: 'A'})
      CREATE (b:Person {name: 'B'})
      CREATE (c:Person {name: 'C'})
      MATCH (a:Person {name: 'A'}), (b:Person {name: 'B'}) CREATE (a)-[:R]->(b)
      MATCH (b:Person {name: 'B'}), (c:Person {name: 'C'}) CREATE (b)-[:R]->(c)
    `
    );
    const r = await run(
      page,
      "MATCH p=(a:Person {name: 'A'})-[*1..2]->(c:Person {name:'C'}) RETURN nodes(p) AS ns, relationships(p) AS rs, length(p) AS l"
    );
    expect(Array.isArray((r as any).result[0].ns)).toBeTruthy();
    expect(Array.isArray((r as any).result[0].rs)).toBeTruthy();
    expect(typeof (r as any).result[0].l).toBe("number");
  });

  test("ORDER BY, SKIP, LIMIT and WHERE", async ({ page }) => {
    await openGraph(page);
    await runLines(
      page,
      `
      CREATE (:N {v: 3})
      CREATE (:N {v: 1})
      CREATE (:N {v: 2})
    `
    );
    const r = await run(
      page,
      "MATCH (n:N) WHERE n.v >= 1 RETURN n.v AS v ORDER BY v DESC SKIP 1 LIMIT 1"
    );
    expect((r as any).result[0].v).toBe(2);
  });

  test("DELETE and DETACH DELETE nodes and relationships", async ({ page }) => {
    await openGraph(page);
    await runLines(
      page,
      `
      CREATE (a:X {id: 1})
      CREATE (b:X {id: 2})
      MATCH (a:X {id: 1}),(b:X {id: 2}) CREATE (a)-[:REL]->(b)
    `
    );
    // Cannot delete a node with relationships without DETACH
    await expect(run(page, "MATCH (a:X {id: 1}) DELETE a")).rejects.toThrow();
    // Detach delete works
    await run(page, "MATCH (a:X {id: 1}) DETACH DELETE a");
    const s = await snapshot(page);
    expect(s.nodes.some((n: any) => n.properties.id === 1)).toBeFalsy();
  });

  test("SHOW CONSTRAINTS and STATS", async ({ page }) => {
    await openGraph(page);
    await run(
      page,
      "CREATE CONSTRAINT emp_email ON (e:Employee) ASSERT e.email IS UNIQUE"
    );
    const c = await run(page, "SHOW CONSTRAINTS");
    expect((c as any).columns).toContain("name");
    expect(Array.isArray((c as any).data)).toBeTruthy();
    const s = await run(page, "SHOW STATS");
    expect((s as any).columns).toEqual(["metric", "value"]);
  });

  test("shortestPath and allShortestPaths", async ({ page }) => {
    await openGraph(page);
    await runLines(
      page,
      `
      CREATE (a:N {id: 1})
      CREATE (b:N {id: 2})
      CREATE (c:N {id: 3})
      MATCH (a:N {id: 1}), (b:N {id: 2}) CREATE (a)-[:T]->(b)
      MATCH (b:N {id: 2}), (c:N {id: 3}) CREATE (b)-[:T]->(c)
      MATCH (a:N {id: 1}), (c:N {id: 3}) CREATE (a)-[:T]->(c)
    `
    );
    const sp = await run(
      page,
      "RETURN shortestPath((a:N {id: 1})-[*]-(c:N {id: 3})) AS path"
    );
    expect((sp as any).type).toBe("tabular");
    const asp = await run(
      page,
      "RETURN allShortestPaths((a:N {id: 1})-[*]-(c:N {id: 3})) AS paths"
    );
    expect((asp as any).type).toBe("tabular");
  });

  test("DROP CONSTRAINT and db.indexes/constraints", async ({ page }) => {
    await openGraph(page);
    await run(
      page,
      "CREATE CONSTRAINT emp_email ON (e:Employee) ASSERT e.email IS UNIQUE"
    );
    let c = await run(page, "CALL db.constraints()");
    expect((c as any).data.length).toBeGreaterThan(0);
    await run(page, "DROP CONSTRAINT emp_email");
    c = await run(page, "CALL db.constraints()");
    expect((c as any).data.length).toBe(0);
    await run(page, "CREATE INDEX ON :Employee(department)");
    const i = await run(page, "CALL db.indexes()");
    expect((i as any).data.length).toBeGreaterThan(0);
  });

  test("shortestPath respects direction and type filters", async ({ page }) => {
    await openGraph(page);
    await runLines(
      page,
      `
      CREATE (a:P {id:1})
      CREATE (b:P {id:2})
      CREATE (c:P {id:3})
      MATCH (a:P {id:1}),(b:P {id:2}) CREATE (a)-[:T]->(b)
      MATCH (b:P {id:2}),(c:P {id:3}) CREATE (b)-[:U]->(c)
    `
    );
    // Directed out path from a to c via T then U (2 hops)
    const r1 = await run(
      page,
      "RETURN shortestPath((a:P {id:1})-[:T|U*1..2]->(c:P {id:3})) AS p"
    );
    expect(
      (r1 as any).data?.length ?? (r1 as any).result?.length ?? 0
    ).toBeGreaterThan(0);
    // Directed only works a->b->c; reverse directed should fail
    const r2 = await run(
      page,
      "RETURN shortestPath((c:P {id:3})-[:T|U*1..2]->(a:P {id:1})) AS p"
    );
    // Should be 0 paths
    const rows = (r2 as any).data || (r2 as any).result || [];
    expect(rows.length).toBe(0);
  });

  test('SHOW INDEXES', async ({ page }) => {
    await openGraph(page);
    await run(page, 'CREATE INDEX ON :Employee(department)');
    const s = await run(page, 'SHOW INDEXES');
    expect((s as any).type).toBe('tabular');
    expect((s as any).columns).toEqual(['entityType','labelsOrTypes','properties']);
    expect(((s as any).data || []).some((row: any) => (row.labelsOrTypes||[]).includes('Employee'))).toBeTruthy();
  });

  test('SHOW DATABASES and current flag', async ({ page }) => {
    await openGraph(page);
    await run(page, 'CREATE DATABASE demo');
    await run(page, 'USE demo');
    const r = await run(page, 'SHOW DATABASES');
    expect((r as any).type).toBe('tabular');
    const rows = (r as any).data || [];
    expect(rows.some((x: any) => x.name === 'demo' && x.current === true)).toBeTruthy();
  });

  test('SHOW TRANSACTIONS reflects BEGIN/COMMIT', async ({ page }) => {
    await openGraph(page);
    await run(page, 'BEGIN');
    const r1 = await run(page, 'SHOW TRANSACTIONS');
    expect((r1 as any).data.length).toBe(1);
    expect((r1 as any).data[0].state).toMatch(/Active/i);
    await run(page, 'COMMIT');
    const r2 = await run(page, 'SHOW TRANSACTIONS');
    expect((r2 as any).data.length).toBe(0);
  });

  test('Console shows [OK] and pretty results', async ({ page }) => {
    await openGraph(page);
    // Use editor and Run button
    await page.evaluate(() => {
      const ed = (window as any).CodeMirror?.instances?.[0] || null;
    });
    // Fallback: set textarea value via API
    await page.evaluate(() => {
      const editor = (document.querySelector('#command-editor') as HTMLTextAreaElement);
      (window as any).cmSet = (txt: string) => (window as any).editor?.setValue?.(txt);
    });
    // Set content using the exposed CodeMirror from app context
    await page.evaluate(() => {
      const cm: any = (window as any).editor; // defined in app scope
      cm.setValue("CREATE (:N {v:1})\nMATCH (n:N) RETURN n");
    });
    await page.click('#run-command-btn');
    // Expect OK and a JSON result block appended
    await page.waitForSelector('#console-output-content:has-text("[OK]")');
    const okText = await page.textContent('#console-output-content');
    expect(okText).toContain('[OK]');
    expect(okText).toMatch(/\{\s*"_type":\s*"node"/);
  });

  test('Console shows [ERROR] on invalid query', async ({ page }) => {
    await openGraph(page);
    await page.evaluate(() => {
      const cm: any = (window as any).editor;
      cm.setValue("MATCH (n) RETURN");
    });
    await page.click('#run-command-btn');
    await page.waitForSelector('#console-output-content:has-text("[ERROR]")');
    const errText = await page.textContent('#console-output-content');
    expect(errText).toContain('[ERROR]');
  });

  test('Constraint violation yields error', async ({ page }) => {
    await openGraph(page);
    await run(page, 'CREATE CONSTRAINT emp_email ON (e:Employee) ASSERT e.email IS UNIQUE');
    await run(page, "CREATE (:Employee {email: 'x@a'})");
    await expect(run(page, "CREATE (:Employee {email: 'x@a'})")).rejects.toThrow(/Constraint violation|already exists/i);
  });

  test('Unsupported SHOW variant errors', async ({ page }) => {
    await openGraph(page);
    await expect(run(page, 'SHOW PROCEDURES')).rejects.toThrow(/Unsupported SHOW/i);
  });

  test('Invalid syntax errors via runLines', async ({ page }) => {
    await openGraph(page);
    await expect(run(page, 'RETURN')).rejects.toThrow();
  });
});
