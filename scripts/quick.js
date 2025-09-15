const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // start static server defined by tests? We assume tests run via 'tests/static-server.cjs'. We'll just open the file directly via file:// path fallback
  const url = 'file://' + require('path').resolve(__dirname, '..', 'GraphBased.html');
  await page.goto(url);
  await page.waitForFunction(() => window.__graphTest !== undefined);
  await page.evaluate(() => window.__graphTest.reset());
  async function run(q){
    const res = await page.evaluate(q => window.__graphTest.run(q), q);
    return res;
  }
  await run("CREATE (:Y {name:'Alice'})");
  await run("CREATE (:Y {name:'Alicia'})");
  await run("CREATE (:Y {name:'Bob'})");
  const r1 = await run("MATCH (p:Y) WHERE p.name STARTS WITH 'Ali' RETURN p.name AS n");
  console.log('R1:', JSON.stringify(r1, null, 2));
  const rRaw = await run("MATCH (p:Y) WHERE p.name STARTS WITH 'Ali' RETURN p");
  console.log('Rraw:', JSON.stringify(rRaw, null, 2));
  const rNoWhere = await run("MATCH (p:Y) RETURN p.name AS n");
  console.log('NoWhere:', JSON.stringify(rNoWhere, null, 2));
  // Build a 3-node chain for path size test
  await run("CREATE (:A {i:1})");
  await run("CREATE (:A {i:2})");
  await run("CREATE (:A {i:3})");
  await run("MATCH (a:A {i:1}), (b:A {i:2}) CREATE (a)-[:R]->(b)");
  await run("MATCH (b:A {i:2}), (c:A {i:3}) CREATE (b)-[:R]->(c)");
  const rSize = await run("MATCH p = (a:A {i:1})-[:R]->(b:A)-[:R]->(c:A {i:3}) RETURN size(nodes(p)) AS len");
  console.log('Size nodes(p):', JSON.stringify(rSize, null, 2));
  await browser.close();
})();
