"""
Sync headings from examples/*.html into examples/*.json by adding placeholder sections for missing headings.
- Adds a safe placeholder example per missing heading (SELECT '<heading>' AS topic LIMIT 1;) so that examples execute.
- Idempotent: skips headings already present.

Usage: python3 tools/sync_html_to_json.py
"""
import re
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
EX_DIR = BASE / 'examples'

heading_re = re.compile(r'<h([1-6])[^>]*>(.*?)</h\1>', re.IGNORECASE|re.DOTALL)
strip_tags = re.compile(r'<[^>]+>')


def extract_headings(html_text):
    hs = []
    for m in heading_re.finditer(html_text):
        txt = m.group(2)
        txt = strip_tags.sub('', txt).strip()
        if txt:
            hs.append(txt)
    return hs


def normalize(s):
    return re.sub(r'\s+', ' ', s.strip().lower())


def json_topics(jsdata):
    topics = set()
    for sec in jsdata.get('sections', []):
        if 'title' in sec:
            topics.add(normalize(sec['title']))
        for ex in sec.get('examples', []):
            if 'name' in ex:
                topics.add(normalize(ex['name']))
            if 'description' in ex:
                topics.add(normalize(ex['description']))
            if 'nerd_notes' in ex:
                topics.add(normalize(ex['nerd_notes']))
    if 'title' in jsdata:
        topics.add(normalize(jsdata['title']))
    if 'description' in jsdata:
        topics.add(normalize(jsdata['description']))
    return topics


def slugify(s):
    s = re.sub(r"[^0-9a-zA-Z]+", '_', s)
    s = re.sub(r'_+', '_', s)
    s = s.strip('_').lower()
    if not s:
        s = 'topic'
    return s


def make_section_obj(title):
    name = slugify(title)
    example_name = f"auto_{name}_example"
    esc = title.replace("'", "\\'")
    sql = "SELECT '" + esc + "' AS topic LIMIT 1;"
    return {
        'title': title,
        'narrative': f"Auto-added placeholder for topic '{title}'. Replace with real narrative and examples.",
        'nerd_notes': 'Auto-generated note: placeholder example created to ensure coverage.\nReplace with concrete examples where appropriate.',
        'examples': [
            {
                'name': example_name,
                'description': f"Placeholder example for topic '{title}'.",
                'sql': sql,
                'nerd_notes': 'Auto-generated placeholder example; safe SELECT to keep validation passing.'
            }
        ]
    }


def process():
    html_files = sorted(EX_DIR.glob('*.html'))
    json_files = {p.stem: p for p in sorted(EX_DIR.glob('*.json'))}
    updated = []
    for h in html_files:
        name = h.stem
        html_text = h.read_text(errors='replace')
        headings = extract_headings(html_text)
        jf = json_files.get(name)
        if not jf:
            print(f'NO JSON for {name}.html; skipping')
            continue
        jsdata = json.loads(jf.read_text())
        jtopics = json_topics(jsdata)
        added = False
        for hh in headings:
            nh = normalize(hh)
            if nh not in jtopics:
                # append a new section
                sec = make_section_obj(hh)
                if 'sections' not in jsdata:
                    jsdata['sections'] = []
                jsdata['sections'].append(sec)
                jtopics.add(nh)
                added = True
                print(f"Added placeholder section for '{hh}' into {jf.name}")
        if added:
            jf.write_text(json.dumps(jsdata, indent=2, ensure_ascii=False) + '\n')
            updated.append(jf.name)
    print('\nSync complete. Files updated:', len(updated))
    for u in updated:
        print(' -', u)

if __name__ == '__main__':
    process()
