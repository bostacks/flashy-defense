#!/usr/bin/env python3
"""Parse a high-score submission issue and merge it into HIGHSCORES.md.

The issue body must contain a machine-readable block:

    <!-- highscore-data {"name":"Alice","score":12450,"wave":8,"kills":42} -->

Outputs a JSON status to stdout for the workflow to consume.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
HS_FILE = REPO_ROOT / "HIGHSCORES.md"
MAX_ENTRIES = 50

DATA_RE = re.compile(r"<!--\s*highscore-data\s*(\{.*?\})\s*-->", re.DOTALL)
TABLE_START = "<!-- HIGHSCORES_TABLE_START -->"
TABLE_END = "<!-- HIGHSCORES_TABLE_END -->"


def emit(payload: dict) -> None:
    print(json.dumps(payload))


def fail(msg: str) -> None:
    emit({"ok": False, "error": msg})
    sys.exit(0)


def parse_issue_body(body: str) -> dict:
    m = DATA_RE.search(body or "")
    if not m:
        fail("missing highscore-data block")
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError as e:
        fail(f"invalid JSON: {e}")
    # Validate
    name = str(data.get("name", "")).strip()
    if not name or len(name) > 20:
        fail("name must be 1-20 chars")
    try:
        score = int(data.get("score", 0))
        wave  = int(data.get("wave", 0))
        kills = int(data.get("kills", 0))
    except (ValueError, TypeError):
        fail("score/wave/kills must be integers")
    if not (0 <= score <= 10_000_000):
        fail("score out of range")
    return {"name": name, "score": score, "wave": wave, "kills": kills}


def parse_existing_table(md: str) -> list[dict]:
    try:
        block = md.split(TABLE_START, 1)[1].split(TABLE_END, 1)[0]
    except IndexError:
        return []
    rows = []
    for line in block.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        # Skip the header and the divider
        if not cells or cells[0] in ("Rank", "—") or set(cells[0]) <= {"-", " "}:
            continue
        # Skip the "no scores yet" placeholder
        if len(cells) < 6 or cells[1].startswith("_"):
            continue
        try:
            rows.append({
                "name":  cells[1],
                "score": int(cells[2].replace(",", "")),
                "wave":  int(cells[3]),
                "kills": int(cells[4]),
                "date":  cells[5],
            })
        except ValueError:
            # Malformed row — skip rather than crash
            continue
    return rows


def render_table(entries: list[dict]) -> str:
    if not entries:
        body = "| — | _no scores yet — be the first!_ | — | — | — | — |"
    else:
        body = "\n".join(
            f"| {i+1} | {e['name']} | {e['score']:,} | {e['wave']} | {e['kills']} | {e['date']} |"
            for i, e in enumerate(entries)
        )
    return (
        "| Rank | Name | Score | Wave | Kills | Date |\n"
        "|------|------|-------|------|-------|------|\n"
        f"{body}"
    )


def main() -> None:
    body = os.environ.get("ISSUE_BODY", "")
    entry = parse_issue_body(body)
    entry["date"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    md = HS_FILE.read_text(encoding="utf-8") if HS_FILE.exists() else ""
    rows = parse_existing_table(md)
    rows.append(entry)
    rows.sort(key=lambda r: r["score"], reverse=True)
    rows = rows[:MAX_ENTRIES]

    # 1-based rank of the just-added entry (or None if it didn't make the cut)
    rank = None
    for i, r in enumerate(rows):
        if (r["name"], r["score"], r["wave"], r["kills"], r["date"]) == (
            entry["name"], entry["score"], entry["wave"], entry["kills"], entry["date"]
        ):
            rank = i + 1
            break

    new_table = render_table(rows)
    updated_md = re.sub(
        rf"{re.escape(TABLE_START)}.*?{re.escape(TABLE_END)}",
        f"{TABLE_START}\n{new_table}\n{TABLE_END}",
        md, count=1, flags=re.DOTALL,
    )
    # Update the footer timestamp
    updated_md = re.sub(
        r"_Last updated:.*_",
        f"_Last updated: {entry['date']}_",
        updated_md,
    )

    HS_FILE.write_text(updated_md, encoding="utf-8")
    emit({"ok": True, "rank": rank, **entry})


if __name__ == "__main__":
    main()
