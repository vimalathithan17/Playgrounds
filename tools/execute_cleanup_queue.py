#!/usr/bin/env python3
"""
Execute queued DROP statements stored in a DuckDB table `cleanup_queue`.

- Dry-run by default: prints statements and exits without executing.
- Use --confirm to actually execute the statements inside a single transaction.
- Optionally specify --db to point to a DuckDB file; defaults to :memory:.

This script is intentionally separate from the validator to keep examples read-only.
"""
import argparse
import sys
import duckdb


def main():
    ap = argparse.ArgumentParser(description='Execute queued cleanup statements from cleanup_queue table')
    ap.add_argument('--db', default=':memory:', help='DuckDB database path (default: :memory:)')
    ap.add_argument('--confirm', action='store_true', help='Actually execute the queued statements')
    ap.add_argument('--limit', type=int, default=None, help='Limit how many statements to execute (for partial runs)')
    args = ap.parse_args()

    con = duckdb.connect(database=args.db)

    # Ensure the queue exists
    try:
        count = con.execute('SELECT COUNT(*) FROM cleanup_queue').fetchone()[0]
    except Exception:
        print('No cleanup_queue table found. Generate it first in SQL examples.', file=sys.stderr)
        sys.exit(1)

    rows = con.execute('SELECT drop_stmt FROM cleanup_queue ORDER BY drop_stmt').fetchall()
    if not rows:
        print('Queue is empty. Nothing to do.')
        return

    stmts = [r[0] for r in rows]
    if args.limit is not None:
        stmts = stmts[: args.limit]

    print('Preview of statements ({} total{}):'.format(
        len(stmts), f' (limited to {args.limit})' if args.limit else ''
    ))
    for s in stmts:
        print(s)

    if not args.confirm:
        print('\nDry-run complete. Re-run with --confirm to execute inside a transaction.')
        return

    # Execute with a single transaction
    try:
        con.execute('BEGIN;')
        for s in stmts:
            con.execute(s)
        con.execute('COMMIT;')
        print(f'Executed {len(stmts)} statements successfully.')
    except Exception as e:
        con.execute('ROLLBACK;')
        print('Execution failed, rolled back transaction. Error:', e, file=sys.stderr)
        sys.exit(2)


if __name__ == '__main__':
    main()
