# Graph Emulator Smoke Tests

This repo includes a Playwright-based end-to-end smoke suite that exercises the Neo4j/Cypher emulator in `GraphBased.html`.

## Prerequisites
- Node.js 18+ installed

## Install and run

```bash
# From repo root
npm install
npx playwright install --with-deps

# Run the tests (starts a static server automatically)
npx playwright test --config=tests/playwright.config.ts
```

## What it covers
- Database commands: HELP, CREATE/DROP/USE database
- CREATE/MATCH of nodes and relationships
- Direction, alternation types ([:A|:B]), properties, variable hops (*1..N)
- SET/REMOVE properties and labels
- MERGE with ON CREATE/ON MATCH
- UNWIND list expansion and creation
- Constraints and Indexes (create + snapshot verification)
- Procedures: CALL db.labels(), db.relationshipTypes(), db.propertyKeys()
- Path helpers: nodes(), relationships(), length()
- WHERE, ORDER BY, SKIP, LIMIT
- DELETE and DETACH DELETE

The tests use non-intrusive hooks (`window.__graphTest`) exposed by `GraphBased.html` for reliable assertions.
