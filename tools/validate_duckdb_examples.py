"""
Validate SQL examples stored in JSON files under examples/ against a local DuckDB instance.
This script loads each JSON, iterates sections/examples, executes their `sql` field as a script,
and reports any errors. It will stop at the first failing SQL statement per example but continues
through all files to collect a full report.

Usage: python tools/validate_duckdb_examples.py

It requires duckdb package; if missing the script exits with instructions.
"""
import json
import glob
import duckdb
import sys
import os
import argparse

ROOT = os.path.dirname(os.path.dirname(__file__))
EXAMPLES_DIR = os.path.join(ROOT, 'examples')

parser = argparse.ArgumentParser(description='Validate DuckDB SQL examples in examples/*.json')
parser.add_argument('--persistent-db', dest='dbpath', default=':memory:', help='Path to persistent DuckDB file (default: in-memory)')
args = parser.parse_args()

files = sorted(glob.glob(os.path.join(EXAMPLES_DIR, '*.json')))
if not files:
    print('No JSON files found in', EXAMPLES_DIR)
    sys.exit(1)

con = duckdb.connect(database=args.dbpath)
con.execute('PRAGMA threads=1')

report = []

for p in files:
    with open(p, 'r') as f:
        j = json.load(f)
    title = j.get('title', os.path.basename(p))
    file_report = {'file': p, 'title': title, 'sections': []}
    for s in j.get('sections', []):
        sec_r = {'title': s.get('title','<no-title>'), 'examples': []}
        for ex in s.get('examples', []):
            name = ex.get('name','<unnamed>')
            sql = ex.get('sql','')
            ex_r = {'name': name, 'status': 'ok', 'error': None, 'sample_row': None}
            if not sql.strip():
                ex_r['status'] = 'skipped'
                sec_r['examples'].append(ex_r)
                continue
            try:
                # execute as a script; duckdb-python allows executing multiple statements
                res = con.execute(sql)
                # try to fetch a sample row if the last statement returned rows
                try:
                    rows = res.fetchmany(1)
                    if rows:
                        ex_r['sample_row'] = rows[0]
                except Exception:
                    pass
            except Exception as e:
                ex_r['status'] = 'error'
                ex_r['error'] = str(e)
            sec_r['examples'].append(ex_r)
        file_report['sections'].append(sec_r)
    report.append(file_report)

# print summary
errs = 0
for f in report:
    for s in f['sections']:
        for ex in s['examples']:
            if ex['status'] == 'error':
                errs += 1

print('Checked', len(files), 'files — errors:', errs)
for f in report:
    print('\nFILE:', os.path.relpath(f['file'], ROOT), '-', f['title'])
    for s in f['sections']:
        print(' SECTION:', s['title'])
        for ex in s['examples']:
            status = ex['status']
            line = f"  - {ex['name']}: {status}"
            if status == 'error':
                line += f"  (ERROR: {ex['error']})"
            elif ex.get('sample_row') is not None:
                line += f"  (sample_row: {ex['sample_row']})"
            print(line)

if errs:
    sys.exit(2)
print('\nAll examples executed without error')
