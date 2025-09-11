"""
Add lightweight exercises and answers to each JSON lesson in examples/.
This script appends a top-level `exercises` array when missing and appends a short note to `description`.
It purposefully uses templated SQL answers so it's safe and non-destructive.

Usage: python tools/add_exercises_to_lessons.py
"""
import json, glob, os
ROOT = os.path.dirname(os.path.dirname(__file__))
EXAMPLES = os.path.join(ROOT, 'examples')
files = sorted(glob.glob(os.path.join(EXAMPLES, '*.json')))
count = 0
for p in files:
    with open(p,'r') as f:
        try:
            j = json.load(f)
        except Exception as e:
            print('SKIP (parse error):', p, e)
            continue
    modified = False
    if 'exercises' not in j:
        # templated exercises
        exercises = [
            {
                'id': 'basic-1',
                'prompt': 'List the first 5 rows from the primary table created in this lesson. Replace <table> with the table name you created in section 1.',
                'answer_sql': 'SELECT * FROM <table> LIMIT 5;'
            },
            {
                'id': 'challenge-1',
                'prompt': 'Write an aggregation that groups by a logical key from the main example (e.g., product, user, date) and returns a count or sum.',
                'answer_sql': 'SELECT <key_col>, COUNT(*) AS cnt FROM <table> GROUP BY <key_col> ORDER BY cnt DESC;'
            }
        ]
        j['exercises'] = exercises
        modified = True
    # append a short note to description
    if isinstance(j.get('description',''), str) and 'Exercises added' not in j.get('description'):
        j['description'] = j.get('description','').rstrip() + ' Exercises added in the `exercises` field with templated answers.'
        modified = True
    if modified:
        with open(p,'w') as f:
            json.dump(j, f, indent=2, ensure_ascii=False)
        count += 1
        print('Updated', p)
print('Updated', count, 'files')
