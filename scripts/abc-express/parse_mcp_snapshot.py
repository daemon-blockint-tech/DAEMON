#!/usr/bin/env python3
"""Extract snapshot JSON from Supabase MCP execute_sql tool output file."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def extract_snapshot(mcp_text: str) -> dict:
    # MCP wraps SQL result in untrusted-data tags
    m = re.search(
        r"<untrusted-data-[^>]+>\s*(\[.*?\])\s*</untrusted-data",
        mcp_text,
        re.DOTALL,
    )
    if not m:
        raise ValueError("could not find untrusted-data JSON block")
    rows = json.loads(m.group(1))
    if not rows or "snapshot" not in rows[0]:
        raise ValueError("missing snapshot key in MCP result")
    return rows[0]["snapshot"]


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: parse_mcp_snapshot.py <mcp_output.txt> <out_snapshot.json>", file=sys.stderr)
        return 1
    src = Path(sys.argv[1]).read_text()
    if src.strip().startswith("{"):
        try:
            wrapper = json.loads(src)
            src = wrapper.get("result", src)
        except json.JSONDecodeError:
            pass
    snapshot = extract_snapshot(src)
    out = Path(sys.argv[2])
    out.write_text(json.dumps(snapshot, default=str, indent=2))
    total = sum(len(v) if isinstance(v, list) else 0 for v in snapshot.values())
    print(f"wrote {out} ({len(snapshot)} tables, {total} rows)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
