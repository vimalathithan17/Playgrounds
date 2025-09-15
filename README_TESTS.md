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

## Cypher parity notes

- Relationship SET/REMOVE
	- Supported via matched relationship variables: MATCH (a)-[r:TYPE]->(b) SET r.prop = value and MATCH (a)-[r:TYPE]->(b) REMOVE r.prop.
	- Label operations apply to nodes only (e.g., SET n:Label, REMOVE n:Label). Relationships have types, not labels—no non-Cypher extensions.

- Multi-pattern node-only MATCH joins
	- Comma-separated node patterns produce a Cartesian product as in Cypher: MATCH (a:LabelA), (b:LabelB) ...
	- Each node pattern honors its own labels and inline property filters.

- WITH and RETURN grouping semantics
	- When any aggregate is present, non-aggregated expressions define the group-by keys, matching Cypher behavior (e.g., WITH n.label AS d, COUNT(*) AS c ...).
	- ORDER BY/WHERE can be applied after WITH using the projected aliases.

- ID/LABELS/TYPE/STARTNODE/ENDNODE
	- Functions follow Cypher semantics in result shape: LABELS(node) returns an array; TYPE(rel) returns the relationship type; STARTNODE/ENDNODE return node entities; ID(entity) returns an internal numeric id.

Notes and limitations
- The emulator targets pragmatic Cypher parity used by the tests and does not add non-Cypher features.
- Some advanced Cypher features are simplified or partially supported (e.g., complex nested subqueries, exhaustive planner behavior). Tests document the expected scope.

### Recently verified behaviors

- Aggregation-only projections yield one row even on empty input
	- Example: `MATCH (n:Nope) RETURN COUNT(*) AS c` returns a single row `{ c: 0 }`.
- Variable-length paths support zero-hop when min is 0
	- Example: `MATCH (a:Z0 {id:1})-[:R*0..2]->(a) RETURN COUNT(*)` counts the trivial path (a to a).
- Inbound direction matching works for single hops
	- Example: `MATCH (c)<-[:Y]-(:TB {id:2}) RETURN COUNT(*)` matches an incoming Y relationship to `c`.
- List predicates and null lists
	- In WHERE, `ANY/NONE/SINGLE` over a null list behaves as no match (row filtered), while `ALL` over `[]` is true (vacuous truth) — consistent with Cypher’s three-valued logic effects in filtering.
- COLLECT handling with nulls and DISTINCT
	- `collect(x)` retains null entries; `collect(DISTINCT x)` collapses duplicates and keeps a single null when present.
