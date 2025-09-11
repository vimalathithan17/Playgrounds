"""
Expand and replace templated exercises in examples/*.json with concrete exercises.
Logic:
 - Detect main table name from section 1 by looking for `CREATE TABLE <name>(...)` or `INSERT INTO <name>`.
 - Extract column names and types from the CREATE statement if available.
 - Create 2-3 tailored exercises with full SQL answers using detected table and columns.
 - If detection fails, the file is skipped and left unchanged.

Usage: pipenv run python tools/expand_exercises.py
"""
import re, json, glob, os
ROOT = os.path.dirname(os.path.dirname(__file__))
EXAMPLES = os.path.join(ROOT, 'examples')
files = sorted(glob.glob(os.path.join(EXAMPLES, '*.json')))

create_re = re.compile(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w\.\"]+)\s*\((.*?)\)", re.I | re.S)
insert_re = re.compile(r"INSERT\s+INTO\s+([\w\.\"]+)", re.I)
col_split_re = re.compile(r"\s*,\s*(?![^()]*\))")
col_name_re = re.compile(r"^\s*\"?([A-Za-z_][A-Za-z0-9_]*)\"?\s+([A-Za-z0-9\(\) ]+)", re.I)

updated = []
skipped = []
for p in files:
    with open(p,'r') as f:
        try:
            j = json.load(f)
        except Exception as e:
            skipped.append((p, 'parse error'))
            continue
    # find section 1 SQL
    sections = j.get('sections', [])
    if not sections:
        skipped.append((p, 'no sections'))
        continue
    sec1 = sections[0]
    sql_block = ''
    for ex in sec1.get('examples', []):
        sql_block += '\n' + ex.get('sql','')
    table = None
    cols = []
    types = {}
    m = create_re.search(sql_block)
    if m:
        table = m.group(1).strip().strip('"')
        cols_def = m.group(2)
        # split columns by commas not in parentheses
        parts = col_split_re.split(cols_def)
        for part in parts:
            cm = col_name_re.match(part.strip())
            if cm:
                cname = cm.group(1)
                ctype = cm.group(2)
                cols.append(cname)
                types[cname] = ctype.strip()
    else:
        m2 = insert_re.search(sql_block)
        if m2:
            table = m2.group(1).strip().strip('"')
    if not table:
        skipped.append((p, 'no table detected'))
        continue
    # pick key_col and agg_col
    key_col = None
    agg_col = None
    if cols:
        key_col = cols[0]
        # prefer numeric types for agg_col
        for c in cols:
            t = types.get(c,'').upper()
            if any(x in t for x in ('INT','DOUBLE','NUMERIC','DECIMAL','REAL','FLOAT')):
                agg_col = c
                break
        if not agg_col and len(cols) > 1:
            agg_col = cols[1]
    else:
        # fallbacks
        key_col = 'id'
        agg_col = 'value'
    # build exercises
    exercises = []
    # 1: basic select
    exercises.append({
        'id':'basic-select',
        'prompt': f'Show the first 5 rows from `{table}`.',
        'answer_sql': f'SELECT * FROM {table} LIMIT 5;'
    })
    # 2: aggregation
    if agg_col:
        # if agg_col same as key_col and likely non-numeric, do COUNT only
        if agg_col == key_col:
            exercises.append({
                'id':'aggregate-1',
                'prompt': f'Count rows grouped by `{key_col}`.',
                'answer_sql': f'SELECT {key_col}, COUNT(*) AS cnt FROM {table} GROUP BY {key_col} ORDER BY cnt DESC;'
            })
        else:
            exercises.append({
                'id':'aggregate-1',
                'prompt': f'Group by `{key_col}` and compute COUNT and SUM({agg_col}).',
                'answer_sql': f'SELECT {key_col}, COUNT(*) AS cnt, SUM({agg_col}) AS total_{agg_col} FROM {table} GROUP BY {key_col} ORDER BY cnt DESC;'
            })
    else:
        exercises.append({
            'id':'aggregate-1',
            'prompt': f'Count rows grouped by `{key_col}`.',
            'answer_sql': f'SELECT {key_col}, COUNT(*) AS cnt FROM {table} GROUP BY {key_col} ORDER BY cnt DESC;'
        })
    # 3: filter / top
    if agg_col:
        # build a numeric condition only if the detected type looks numeric
        agg_type = types.get(agg_col, '').upper()
        is_numeric = any(x in agg_type for x in ("INT", "DOUBLE", "NUMERIC", "DECIMAL", "REAL", "FLOAT"))
        numeric_cond = f" AND {agg_col} > 0" if is_numeric else ""
        exercises.append({
            'id':'filter-top',
            'prompt': f'Select the top 10 rows where `{agg_col}` is positive (if numeric) or not null otherwise.',
            'answer_sql': f'SELECT * FROM {table} WHERE {agg_col} IS NOT NULL{numeric_cond} LIMIT 10;'
        })
    else:
        exercises.append({
            'id':'filter-top',
            'prompt': f'Select any 10 non-null rows.',
            'answer_sql': f'SELECT * FROM {table} WHERE {key_col} IS NOT NULL LIMIT 10;'
        })
    # replace exercises
    j['exercises'] = exercises
    # update description
    desc = j.get('description','')
    note = f' Concrete exercises auto-generated for table `{table}`.'
    if note.strip() not in desc:
        j['description'] = desc.rstrip() + ' ' + note
    with open(p,'w') as f:
        json.dump(j, f, indent=2, ensure_ascii=False)
    updated.append((p,table,key_col,agg_col))

# summary
print('Updated', len(updated), 'files')
if skipped:
    print('Skipped', len(skipped), 'files:')
    for s in skipped[:10]:
        print(' ', s)

for u in updated[:10]:
    print(' ', os.path.basename(u[0]), '-> table=', u[1], 'key=', u[2], 'agg=', u[3])
