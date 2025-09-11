"""
Compare headings in examples/*.html with sections/examples in examples/*.json.
Usage: python3 tools/check_html_vs_json.py

Reports per-file missing headings.
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
    # section titles
    for sec in jsdata.get('sections', []):
        if 'title' in sec:
            topics.add(normalize(sec['title']))
        # examples: name + description
        for ex in sec.get('examples', []):
            if 'name' in ex:
                topics.add(normalize(ex['name']))
            if 'description' in ex:
                topics.add(normalize(ex['description']))
            if 'nerd_notes' in ex:
                topics.add(normalize(ex['nerd_notes']))
    # top-level fields
    if 'title' in jsdata:
        topics.add(normalize(jsdata['title']))
    if 'description' in jsdata:
        topics.add(normalize(jsdata['description']))
    return topics


def main():
    html_files = sorted(EX_DIR.glob('*.html'))
    json_files = {p.stem: p for p in sorted(EX_DIR.glob('*.json'))}
    total_missing = 0
    for h in html_files:
        name = h.stem
        html_text = h.read_text(errors='replace')
        headings = extract_headings(html_text)
        norm_headings = [normalize(x) for x in headings]
        jf = json_files.get(name)
        if not jf:
            print(f'NO JSON: {name}.html -> missing json file {name}.json')
            total_missing += len(norm_headings)
            continue
        jsdata = json.loads(jf.read_text())
        jtopics = json_topics(jsdata)
        missing = []
        for hh,nh in zip(headings,norm_headings):
            if nh not in jtopics:
                missing.append(hh)
        if missing:
            total_missing += len(missing)
            print(f'--- {name}.html -> {name}.json: MISSING {len(missing)} topics ---')
            for m in missing:
                print('  *', m)
        else:
            print(f'+++ {name}.html -> {name}.json: all headings covered')
    print('\nSummary: total missing headings across files:', total_missing)

if __name__ == '__main__':
    main()
