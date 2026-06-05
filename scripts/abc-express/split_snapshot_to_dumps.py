#!/usr/bin/env python3
"""Split full snapshot JSON into per-table dump files."""
from __future__ import annotations

import json
import sys
from pathlib import Path

DUMP_DIR = Path(__file__).parent / "dumps"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: split_snapshot_to_dumps.py <snapshot.json>", file=sys.stderr)
        return 1
    snapshot_path = Path(sys.argv[1])
    raw = json.loads(snapshot_path.read_text())
    if isinstance(raw, list) and raw and "snapshot" in raw[0]:
        data = raw[0]["snapshot"]
    elif isinstance(raw, dict) and "snapshot" in raw:
        data = raw["snapshot"]
    elif isinstance(raw, dict):
        data = raw
    else:
        print("unexpected snapshot shape", file=sys.stderr)
        return 1

    DUMP_DIR.mkdir(parents=True, exist_ok=True)
    total = 0
    for table, rows in sorted(data.items()):
        if not isinstance(rows, list):
            rows = []
        out = DUMP_DIR / f"{table}.json"
        out.write_text(json.dumps(rows, default=str, indent=2))
        print(f"{table}: {len(rows)}")
        total += len(rows)
    print(f"TOTAL: {total} rows across {len(data)} tables")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
