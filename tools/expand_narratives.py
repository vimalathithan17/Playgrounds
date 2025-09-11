"""
Add narratives and nerd_notes to all JSON lessons in the examples/ folder.
Idempotent: will only add fields when missing.
Run: python3 tools/expand_narratives.py
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
EXAMPLES_DIR = BASE / 'examples'

def make_section_narrative(title):
    # Simple heuristics to make a short narrative based on section title
    t = title.lower()
    if 'setup' in t or 'create' in t:
        return "Create objects and small sample data used by subsequent examples. Keep these steps idempotent."
    if 'cleanup' in t or 'drop' in t:
        return "Tear down objects created in this lesson so the examples are repeatable and safe to re-run."
    if 'time' in t or 'date' in t:
        return "Work with dates and timestamps: extraction, arithmetic, and bucketing for reporting."
    if 'window' in t or 'partition' in t:
        return "Demonstrate windowing and partitioning techniques used for analytics and performant queries."
    if 'join' in t:
        return "Show different join patterns and when to use them."
    if 'index' in t or 'index' in t:
        return "Discuss data layout and partitioning strategies (DuckDB is columnar; indexes behave differently)."
    # fallback
    return f"Short explanations and examples about {title}."


def make_section_nerdnotes(title):
    return "Practical note: this example is simplified for teaching. See the nerd notes in each example for tips and production caveats."


def make_example_description(name):
    # Friendly sentence from example name
    return name.replace('_', ' ').capitalize() + ": a short demo."


def make_example_nerdnotes(name):
    return "Nerd note: shows basic usage; for production, consider types, null handling, and performance trade-offs."


def process_file(p: Path):
    changed = False
    data = json.loads(p.read_text())
    sections = data.get('sections')
    if not sections:
        # add a short top-level note if file has no sections
        meta = data.get('meta', {})
        if 'note' not in data:
            data['note'] = data.get('description', '') + ' (auto-enhanced with narratives)'
            changed = True
        if changed:
            p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
        return changed

    for sec in sections:
        title = sec.get('title','')
        if 'narrative' not in sec:
            sec['narrative'] = make_section_narrative(title)
            changed = True
        if 'nerd_notes' not in sec:
            sec['nerd_notes'] = make_section_nerdnotes(title)
            changed = True
        examples = sec.get('examples', [])
        for ex in examples:
            if 'description' not in ex:
                ex['description'] = make_example_description(ex.get('name','example'))
                changed = True
            if 'nerd_notes' not in ex:
                ex['nerd_notes'] = make_example_nerdnotes(ex.get('name','example'))
                changed = True
    if changed:
        p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')
    return changed


def main():
    files = sorted(EXAMPLES_DIR.glob('*.json'))
    updated = []
    for p in files:
        try:
            if process_file(p):
                updated.append(p.name)
        except Exception as e:
            print('ERROR processing', p, e)
    print('Updated files:', len(updated))
    for u in updated:
        print(' -', u)

if __name__ == '__main__':
    main()
