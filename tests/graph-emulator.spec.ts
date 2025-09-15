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

  test('RETURN-only queries and expressions', async ({ page }) => {
    await openGraph(page);
    const r1 = await run(page, "RETURN 1 AS one, 'x' AS s, 1+2*3 AS n");
    expect((r1 as any).type).toBe('tabular');
    const row = (r1 as any).data[0];
    expect(row.one).toBe(1);
    expect(row.s).toBe('x');
    expect(row.n).toBe(7);
  });

  test('UNION and UNION ALL', async ({ page }) => {
    await openGraph(page);
    const u1 = await run(page, 'RETURN 1 AS x UNION RETURN 1 AS x');
    expect((u1 as any).data.length).toBe(1);
    const u2 = await run(page, 'RETURN 1 AS x UNION ALL RETURN 1 AS x');
    expect((u2 as any).data.length).toBe(2);
  });

  test('CASE WHEN in RETURN and map projections', async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:M {v:1, name:'a'})
      CREATE (:M {v:2, name:'b'})
    `);
    const c = await run(page, "MATCH (m:M) RETURN CASE WHEN m.v > 1 THEN 'hi' ELSE 'lo' END AS k ORDER BY k");
    const ks = (c as any).data.map((r:any)=>r.k);
    expect(ks).toEqual(['hi','lo']);
    const mp = await run(page, "MATCH (m:M {name:'a'}) RETURN m{.*} AS m1, m{.v} AS m2");
    expect((mp as any).data[0].m1).toEqual({v:1, name:'a'});
    expect((mp as any).data[0].m2).toEqual({v:1});
  });

  test('Invalid syntax errors via runLines', async ({ page }) => {
    await openGraph(page);
    await expect(run(page, 'RETURN')).rejects.toThrow();
  });

  // --- Advanced Cypher Feature Tests ---
  test('RETURN DISTINCT eliminates duplicates', async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:X {v:1})");
    await run(page, "CREATE (:X {v:1})");
    await run(page, "CREATE (:X {v:2})");
    const r = await run(page, "MATCH (n:X) RETURN DISTINCT n.v AS val");
    expect(r.type).toBe('tabular');
    const vals = (r.data||[]).map((row:any)=>row.val).sort();
    expect(vals).toEqual([1,2]);
  });

  test('EXISTS() and IS NULL predicates', async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:X {name:'Alpha'})");
    const r = await run(page, "MATCH (p:X) WHERE EXISTS(p.name) AND p.age IS NULL RETURN p.name AS name");
    expect(r.type).toBe('tabular');
    expect((r.data||[]).length).toBe(1);
    expect((r.data||[])[0].name).toBe('Alpha');
  });

  test('String predicates STARTS WITH / ENDS WITH / CONTAINS', async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:Y {name:'Alice'})");
    await run(page, "CREATE (:Y {name:'Alicia'})");
    await run(page, "CREATE (:Y {name:'Bob'})");
    const r1 = await run(page, "MATCH (p:Y) WHERE p.name STARTS WITH 'Ali' RETURN p.name AS n");
    const names1 = (r1.data||[]).map((x:any)=>x.n).sort();
    expect(names1).toEqual(['Alice','Alicia']);
    const r2 = await run(page, "MATCH (p:Y) WHERE p.name CONTAINS 'lic' RETURN p.name AS n");
    const names2 = (r2.data||[]).map((x:any)=>x.n).sort();
    expect(names2).toEqual(['Alice','Alicia']);
    const r3 = await run(page, "MATCH (p:Y) WHERE p.name ENDS WITH 'ice' RETURN p.name AS n");
    const names3 = (r3.data||[]).map((x:any)=>x.n);
    expect(names3).toEqual(['Alice']);
  });

  test('IN operator with list property', async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:Bag {items:['a','b','c']})");
    const r = await run(page, "MATCH (b:Bag) WHERE 'b' IN b.items RETURN b");
    expect(r.type === 'graph' || r.type === 'tabular').toBeTruthy();
  });

  test('collect(distinct ...) vs collect', async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:Emp {dept:'D1'})");
    await run(page, "CREATE (:Emp {dept:'D1'})");
    await run(page, "CREATE (:Emp {dept:'D2'})");
    const r = await run(page, "MATCH (e:Emp) RETURN collect(e.dept) AS all, collect(DISTINCT e.dept) AS uniq");
    expect(r.type).toBe('tabular');
    const row = (r.data||[])[0];
    expect(row.all.length).toBe(3);
    expect(row.uniq.length).toBe(2);
  });

  test('SIZE(nodes(path)) returns correct count', async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:A {i:1})");
    await run(page, "CREATE (:A {i:2})");
    await run(page, "CREATE (:A {i:3})");
    await run(page, "MATCH (a:A {i:1}), (b:A {i:2}) CREATE (a)-[:R]->(b)");
    await run(page, "MATCH (b:A {i:2}), (c:A {i:3}) CREATE (b)-[:R]->(c)");
    const r = await run(page, "MATCH p = (a:A {i:1})-[:R]->(b:A)-[:R]->(c:A {i:3}) RETURN size(nodes(p)) AS len");
    expect(r.type).toBe('tabular');
    expect((r.data||[])[0].len).toBe(3);
  });

  // Phase 2 additions
  test('Regex operator =~ with (?i) and case sensitivity', async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:Z {name:'Alice'})");
    await run(page, "CREATE (:Z {name:'alice'})");
    const r1 = await run(page, "MATCH (z:Z) WHERE z.name =~ '(?i)al.*' RETURN z.name AS n ORDER BY n");
    expect((r1.data||[]).map((x:any)=>x.n)).toEqual(['Alice','alice']);
    const r2 = await run(page, "MATCH (z:Z) WHERE z.name =~ 'Al.*' RETURN z.name AS n ORDER BY n");
    expect((r2.data||[]).map((x:any)=>x.n)).toEqual(['Alice']);
  });

  test('List comprehensions filter and map', async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:LC {nums:[1,2,3,4,5]})");
  // Using arithmetic: keep >2 and map to n*2
  const m0 = await run(page, "MATCH (x:LC) RETURN x");
  // eslint-disable-next-line no-console
  console.log('Match LC rows', m0.data?.length, m0);
  const r = await run(page, "MATCH (x:LC) RETURN [n IN x.nums WHERE n > 2 | n + n] AS out");
  // debug
  // eslint-disable-next-line no-console
  console.log('ListComp result', r);
    expect(r.type).toBe('tabular');
    expect((r.data||[])[0].out).toEqual([6,8,10]);
  });

  test('COALESCE returns first non-null', async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:C {a:null, b:2})");
    await run(page, "CREATE (:C {b:3})");
  const r = await run(page, "MATCH (c:C) RETURN COALESCE(c.a, c.b, 99) AS v ORDER BY v");
  // eslint-disable-next-line no-console
  console.log('COALESCE result', r);
    expect((r.data||[]).map((x:any)=>x.v)).toEqual([2,3]);
  });

  test('UNION level ORDER BY, SKIP, LIMIT', async ({ page }) => {
    await openGraph(page);
    const r = await run(page, "RETURN 2 AS v UNION ALL RETURN 1 AS v UNION ALL RETURN 3 AS v ORDER BY v DESC SKIP 1 LIMIT 1");
    expect((r.data||[])[0].v).toBe(2);
  });

  // New parity tests for recent features
  test('OPTIONAL MATCH returns NULL projections when no match', async ({ page }) => {
    await openGraph(page);
    const r = await run(page, "OPTIONAL MATCH (n:NoSuch) RETURN n AS node, n.name AS name");
    expect((r as any).type).toBe('tabular');
    const rows = (r as any).data || [];
    expect(rows.length).toBe(1);
    expect(rows[0]).toHaveProperty('node');
    expect(rows[0].node).toBeNull();
    expect(rows[0].name).toBeNull();
  });

  test('List predicates ANY/ALL/NONE/SINGLE in WHERE', async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:Bag {items:[1,2,3,4]})");
    await run(page, "CREATE (:Bag {items:[1,1,1]})");
    await run(page, "CREATE (:Bag {items:[]})");

    // ANY: at least one > 3
    const anyR = await run(page, "MATCH (b:Bag) WHERE ANY(x IN b.items WHERE x > 3) RETURN COUNT(b) AS c");
    expect((anyR as any).data[0].c).toBe(1);

    // ALL: all equal to 1 (empty list should be true per Cypher semantics)
    const allR = await run(page, "MATCH (b:Bag) WHERE ALL(x IN b.items WHERE x = 1) RETURN COUNT(b) AS c");
    // Two bags match: [1,1,1] and []
    expect((allR as any).data[0].c).toBe(2);

  // NONE: none less than 1 -> all three bags qualify (1,2,3,4), (1,1,1), and []
  const noneR = await run(page, "MATCH (b:Bag) WHERE NONE(x IN b.items WHERE x < 1) RETURN COUNT(b) AS c");
  expect((noneR as any).data[0].c).toBe(3);

    // SINGLE: exactly one equals 4 -> only [1,2,3,4]
    const singleR = await run(page, "MATCH (b:Bag) WHERE SINGLE(x IN b.items WHERE x = 4) RETURN COUNT(b) AS c");
    expect((singleR as any).data[0].c).toBe(1);
  });

  test('Multi-column ORDER BY with NULLS FIRST/LAST', async ({ page }) => {
    await openGraph(page);
    const r = await run(
      page,
      "RETURN 1 AS a, NULL AS b UNION ALL RETURN 1 AS a, 2 AS b UNION ALL RETURN 1 AS a, 1 AS b ORDER BY a ASC, b ASC NULLS LAST"
    );
    const rows = (r as any).data || [];
    // Expect b: 1, 2, null
    expect(rows.map((x:any)=>x.b)).toEqual([1,2,null]);
  });

  test('NULL literal parsing in RETURN', async ({ page }) => {
    await openGraph(page);
    const r = await run(page, 'RETURN NULL AS z, 1 AS o');
    expect((r as any).type).toBe('tabular');
    expect(((r as any).data||[])[0].z).toBeNull();
    expect(((r as any).data||[])[0].o).toBe(1);
  });

  // New: UNWIND(range), arithmetic null propagation, UNION null alignment
  test('UNWIND range expression', async ({ page }) => {
    await openGraph(page);
    const r = await run(page, 'UNWIND range(1,3) AS n RETURN n');
    const vals = (r as any).result?.map((x:any)=>x.n) || (r as any).data?.map((x:any)=>x.n) || [];
    expect(vals).toEqual([1,2,3]);
  });

  test('Arithmetic null propagation in RETURN', async ({ page }) => {
    await openGraph(page);
    await run(page, "CREATE (:A {x:1})");
    const r = await run(page, 'MATCH (a:A) RETURN a.missing + 2 AS s1, a.missing - 1 AS s2, a.missing * 3 AS s3, a.missing / 2 AS s4');
    const row = (r as any).data[0];
    expect(row.s1).toBeNull();
    expect(row.s2).toBeNull();
    expect(row.s3).toBeNull();
    expect(row.s4).toBeNull();
  });

  test('UNION column alignment fills missing as null', async ({ page }) => {
    await openGraph(page);
    const r = await run(page, 'RETURN 1 AS a UNION ALL RETURN 2 AS b');
    const rows = (r as any).data || [];
    // First row has {a:1}, second should align {a:null}
    expect(rows.length).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(rows[0], 'a')).toBe(true);
    expect(rows[0].a).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(rows[1], 'a')).toBe(true);
    expect(rows[1].a).toBeNull();
  });

  // New tests for added parity features
  test('RETURN * passthrough', async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:RStar {v:1})
      CREATE (:RStar {v:2})
    `);
    const r = await run(page, 'MATCH (n:RStar) RETURN *');
    expect((r as any).type).toBe('tabular');
    const rows = (r as any).data || [];
    // Should include key 'n' with node object
    expect(rows.length).toBe(2);
    expect(rows[0]).toHaveProperty('n');
    expect(rows[0].n?._type).toBe('node');
  });

  test('EXISTS { subquery } predicate', async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:P {id:1})
      CREATE (:P {id:2})
      CREATE (:Q {qid:10})
      MATCH (a:P {id:1}),(b:Q {qid:10}) CREATE (a)-[:REL]->(b)
    `);
    const r = await run(page, "MATCH (p:P) WHERE EXISTS { MATCH (p)-[:REL]->(q:Q) RETURN q } RETURN p");
    const rows = (r as any).data || (r as any).result || [];
    expect(rows.length).toBe(1);
  });

  test('Pattern comprehension produces list', async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:A {id:1})
      CREATE (:A {id:2})
      CREATE (:B {id:3})
      MATCH (a:A {id:1}),(b:A {id:2}) CREATE (a)-[:T]->(b)
      MATCH (b:A {id:2}),(c:B {id:3}) CREATE (b)-[:T]->(c)
    `);
    const r = await run(page, "MATCH (x:A {id:1}) RETURN [ (x)-[r:T]->(y) | y.id ] AS ids");
    expect((r as any).type).toBe('tabular');
    const ids = ((r as any).data||[])[0].ids;
    expect(Array.isArray(ids)).toBeTruthy();
    expect(ids).toEqual([2]);
  });

  test('MERGE relationship with ON CREATE/ON MATCH', async ({ page }) => {
    await openGraph(page);
    // First MERGE should create relationship and set created prop
    let r = await run(page, "MERGE (a:M1 {id:1})-[r:LINK {k:1}]->(b:M2 {id:2}) ON CREATE SET r.flag = 'new' ON MATCH SET r.flag = 'old'");
    expect((r as any).message.toLowerCase()).toContain('created');
    // Second MERGE should match and set 'old'
    r = await run(page, "MERGE (a:M1 {id:1})-[r:LINK {k:1}]->(b:M2 {id:2}) ON CREATE SET r.flag = 'new' ON MATCH SET r.flag = 'old'");
    expect((r as any).message.toLowerCase()).toContain('matched');
    const s = await snapshot(page);
    const rel = s.relationships.find((x:any)=>x.type==='LINK');
    expect(rel.properties.flag).toBe('old');
  });

  test('CALL subquery with WITH and params', async ({ page }) => {
    await openGraph(page);
    const r1 = await run(page, "CALL { WITH 1 AS x RETURN x } RETURN x");
    expect((r1 as any).type).toBe('tabular');
    expect(((r1 as any).data||[])[0].x).toBe(1);
    const r2 = await run(page, "CALL { WITH $p AS y RETURN y } RETURN y", { p: 42 });
    expect(((r2 as any).data||[])[0].y).toBe(42);
  });

  test('EXISTS subquery supports undirected and variable length', async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:P {id:1})
      CREATE (:Q {qid:10})
      MATCH (a:P {id:1}),(b:Q {qid:10}) CREATE (a)-[:REL]->(b)
    `);
    const r1 = await run(page, "MATCH (p:P) WHERE EXISTS { MATCH (p)-[:REL]-(q:Q) RETURN q } RETURN p");
    expect(((r1 as any).data||[]).length).toBe(1);
    const r2 = await run(page, "MATCH (p:P) WHERE EXISTS { MATCH (p)-[:REL*1..2]->(q:Q) RETURN q } RETURN p");
    expect(((r2 as any).data||[]).length).toBe(1);
    const r3 = await run(page, "MATCH (p:P) WHERE EXISTS { MATCH (p)-[:REL]->(q:Q) WHERE q.qid=10 RETURN q } RETURN p");
    expect(((r3 as any).data||[]).length).toBe(1);
  });

  test('FOREACH performs per-item writes', async ({ page }) => {
    await openGraph(page);
    await run(page, "FOREACH (name IN ['A','B','C'] | CREATE (:F {name: name}))");
    const r = await run(page, "MATCH (n:F) RETURN count(n) AS c");
    expect(((r as any).data||[])[0].c).toBe(3);
  });

  test('Built-in string and collection functions', async ({ page }) => {
    await openGraph(page);
    let r = await run(page, "RETURN toLower('ABC') AS a, toUpper('ab') AS b, substring('hello',1,3) AS c");
    const row1 = ((r as any).data||[])[0];
    expect(row1.a).toBe('abc');
    expect(row1.b).toBe('AB');
    expect(row1.c).toBe('ell');
    r = await run(page, "RETURN split('a,b,c', ',') AS s, range(1,5) AS rng");
    const row2 = ((r as any).data||[])[0];
    expect(row2.s).toEqual(['a','b','c']);
    expect(row2.rng).toEqual([1,2,3,4,5]);
  });

  // New tests for parity improvements implemented in executor
  test('Relationship variable SET and REMOVE', async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:A {id:1})
      CREATE (:B {id:2})
      MATCH (a:A {id:1}), (b:B {id:2}) CREATE (a)-[:R {p:1}]->(b)
    `);
    // Set property via matched relationship variable
    let r = await run(page, "MATCH (a:A)-[r:R]->(b:B) SET r.flag = 'x' RETURN TYPE(r) AS t, r.flag AS f");
    expect((r as any).type).toBe('tabular');
    const row = ((r as any).data||[])[0];
    expect(row.t).toBe('R');
    expect(row.f).toBe('x');
    // Remove property via relationship variable
    const r2 = await run(page, "MATCH (a:A)-[r:R]->(b:B) REMOVE r.flag RETURN r.flag AS f");
    const row2 = ((r2 as any).data||[])[0];
    expect(row2.f).toBeNull();
  });

  test('Multi-pattern node-only MATCH produces Cartesian join', async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:L1 {id: 1})
      CREATE (:L1 {id: 2})
      CREATE (:L2 {id: 10})
      CREATE (:L2 {id: 20})
      CREATE (:L2 {id: 30})
    `);
    const r = await run(page, 'MATCH (a:L1), (b:L2) RETURN COUNT(*) AS c');
    expect((r as any).type).toBe('tabular');
    expect(((r as any).data||[])[0].c).toBe(2 * 3);
  });

  test('Grouping in RETURN and WITH with aggregates', async ({ page }) => {
    await openGraph(page);
    await runLines(page, `
      CREATE (:EmpG {dept:'D1'})
      CREATE (:EmpG {dept:'D1'})
      CREATE (:EmpG {dept:'D2'})
    `);
    // RETURN grouping
    const r1 = await run(page, "MATCH (e:EmpG) RETURN e.dept AS d, COUNT(*) AS c ORDER BY d");
    const rows1 = ((r1 as any).data||[]);
    expect(rows1.length).toBe(2);
    expect(rows1[0]).toEqual({ d: 'D1', c: 2 });
    expect(rows1[1]).toEqual({ d: 'D2', c: 1 });
    // WITH grouping then RETURN
    const r2 = await run(page, "MATCH (e:EmpG) WITH e.dept AS d, COUNT(*) AS c RETURN d, c ORDER BY d");
    const rows2 = ((r2 as any).data||[]);
    expect(rows2.length).toBe(2);
    expect(rows2[0]).toEqual({ d: 'D1', c: 2 });
    expect(rows2[1]).toEqual({ d: 'D2', c: 1 });
  });
});
