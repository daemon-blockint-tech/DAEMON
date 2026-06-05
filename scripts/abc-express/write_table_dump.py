#!/usr/bin/env python3
"""Write one table dump JSON file from stdin (array of row objects)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

DUMP_DIR = Path(__file__).parent / "dumps"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: write_table_dump.py <table_name>", file=sys.stderr)
        return 1
    table = sys.argv[1]
    raw = sys.stdin.read().strip()
    if not raw:
        rows: list = []
    else:
        data = json.loads(raw)
        if isinstance(data, list):
            rows = data
        elif isinstance(data, dict) and "data" in data:
            rows = data["data"] if isinstance(data["data"], list) else [data["data"]]
        else:
            print(f"unexpected JSON shape for {table}", file=sys.stderr)
            return 1
    DUMP_DIR.mkdir(parents=True, exist_ok=True)
    out = DUMP_DIR / f"{table}.json"
    out.write_text(json.dumps(rows, default=str, indent=2))
    print(f"{table}: {len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
