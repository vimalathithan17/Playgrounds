# Validate DuckDB SQL examples

This project contains JSON-based SQL lessons in `examples/`. Use the validator to execute each example against DuckDB and report failures.

Quick start (uses pipenv created earlier):

```bash
pipenv install --dev
pipenv run python tools/validate_duckdb_examples.py            # in-memory run
pipenv run python tools/validate_duckdb_examples.py --persistent-db examples/validate.db  # persistent DB file
```

The validator prints a per-example status and exits with non-zero on any error.

If you want to re-run examples against a clean DB file, remove the persistent DB first:

```bash
rm examples/validate.db
```

Report bugs or extend the script in `tools/validate_duckdb_examples.py`.
