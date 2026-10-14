#!/usr/bin/env python3
"""Plain-English questions about, and changes to, a rider's runs.

matrix-bot's "!ask" sends the words to a local model (Ollama), which turns
them into JSON (see SYSTEM): a question becomes one DuckDB SELECT, a change
becomes a SELECT picking the runs plus the fields to set. Neither touches
the lake directly:

  * Every SELECT runs in its own in-memory duckdb with only the asking
    rider's runs in it (table runs, copied out of the lake first) and
    external access turned off, so it can't see anyone else's runs or read
    or write any file, whatever the model wrote.
  * A change only proposes: the bot shows the runs it picked, before and
    after, and a room admin's ✅ on that message applies it, as one lake
    commit that updates those ids for that rider and the EDITABLE fields
    only (see apply_sql).

Only the Python standard library, like the rest of db/.
"""

import json
import os
import re
import subprocess
import urllib.request

# What the model sees of a run: table runs. Dates and times are Hawaii local.
RUN_COLUMNS = """\
id varchar, date date, time time, start_beach varchar, end_beach varchar,
region varchar, board varchar, foil varchar, foil_confidence varchar,
name varchar, description varchar, distance_km double,
distance_on_foil double, duration_sec double, duration_on_foil double,
avg_speed_kmh double, max_speed_1k double, avg_foiling_hr double,
max_hr double, paddle_up_count int"""

SNAPSHOT_SQL = """\
select id::varchar as id, date, time, start_beach, end_beach, region, board,
       foil, foil_confidence, name, description, distance_km,
       distance_on_foil, duration_sec, duration_on_foil, avg_speed_kmh,
       max_speed_1k, avg_foiling_hr, max_hr, paddle_up_count
from dwlist_resolved where rider = {rider}"""

# Fields a change may set, and the values each may take (None: any text).
EDITABLE = {"foil": None, "foil_confidence": {"high", "medium", "low"},
            "board": None, "name": None, "description": None}

SYSTEM = """\
You turn a downwind foil rider's message to a chat bot into JSON. The bot
runs your SQL in DuckDB against one table holding only this rider's runs:

  runs({columns})

distance_km is km, distance_on_foil METRES (divide by 1000 for km),
duration_* seconds, speeds km/h (max_speed_1k is the fastest 1 km),
heart rates bpm. region is e.g. 'Kihei' or 'Maui North Shore'. Use
dayname(date) for days of the week (isodow(date) to order them, Monday
first) and monthname(date) for months. This is DuckDB, not MySQL. A run goes from start_beach to end_beach;
"went to X" means either one. foil is null or 'unknown' when not known.
Today is {today} (Hawaii). Beaches: {beaches}.
This rider's foils: {foils}. Boards: {boards}.

Answer with exactly one of:
  {{"kind": "query", "sql": "<one SELECT over runs answering the question>"}}
  {{"kind": "edit", "sql": "<one SELECT id FROM runs WHERE ... picking the runs to change>",
    "set": {{"<field>": "<value>", ...}}, "count": <how many runs the message says, or null>}}
  {{"kind": "unclear", "say": "<a short question back to the rider>"}}
An edit may set only: foil, foil_confidence ('high', 'medium' or 'low':
how sure the rider is of the foil), board, name, description. Write foil
as the rider wrote it; the bot matches it to a known foil. Use only the
columns above, and keep SELECTs to what the answer needs (at most 20 rows).
"""

ANSWER = """\
A rider asked: {question}
The bot ran this SQL over their runs:
{sql}
and got these rows (JSON): {rows}
Answer the rider in one or two short, plain sentences from those rows only.
Use 24-hour times, km to one decimal, and dates like 3 Oct 2025. If there
are no rows, say so plainly. No preamble."""


class AskError(Exception):
    pass


def sql_str(v):
    return "'" + str(v).replace("'", "''") + "'"


# --- the model --------------------------------------------------------------

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": ["query", "edit", "unclear"]},
        "sql": {"type": "string"},
        "set": {"type": "object"},
        "count": {"type": ["integer", "null"]},
        "say": {"type": "string"},
    },
    "required": ["kind"],
}


def chat(url, model, messages, schema=None, timeout=180):
    """The model's reply to messages, from Ollama's /api/chat at url."""
    body = {"model": model, "messages": messages, "stream": False,
            "options": {"temperature": 0}}
    if schema:
        body["format"] = schema
    req = urllib.request.Request(url.rstrip("/") + "/api/chat", json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)["message"]["content"]


def plan(url, model, question, context, parquet, tries=3):
    """(plan, rows): the model's JSON plan for question (see SYSTEM, which
    context fills) and the rows its SQL gives over parquet's runs (None for
    "unclear"). SQL that fails goes back to the model with its error, up
    to tries times in all."""
    msgs = [{"role": "system", "content": SYSTEM.format(columns=RUN_COLUMNS, **context)},
            {"role": "user", "content": question}]
    for attempt in range(tries):
        out = chat(url, model, msgs, PLAN_SCHEMA)
        try:
            p = json.loads(out)
        except json.JSONDecodeError:
            raise AskError(f"the model didn't answer in JSON: {out[:200]}")
        if p.get("kind") not in ("query", "edit"):
            return p, None
        if not p.get("sql"):
            raise AskError("the model gave no SQL")
        try:
            return p, sandboxed(parquet, p["sql"])
        except AskError as e:
            if attempt == tries - 1:
                raise AskError(f"{e}\n{p['sql']}")
            msgs += [{"role": "assistant", "content": out},
                     {"role": "user", "content": f"That SQL failed in DuckDB:\n{e}\n"
                                                 "Fix it (DuckDB SQL only) and answer in the same JSON."}]


def answer(url, model, question, sql, rows):
    return chat(url, model, [{"role": "user", "content": ANSWER.format(
        question=question, sql=sql, rows=json.dumps(rows[:20], default=str))}]).strip()


# --- the sandbox ------------------------------------------------------------

def one_select(sql):
    """sql as a single SELECT (or WITH ... SELECT) statement, else AskError."""
    s = sql.strip().rstrip(";").strip()
    if ";" in s:
        raise AskError("only one statement, please")
    if not re.match(r"(?is)^(select|with|from)\b", s):
        raise AskError("only a SELECT can read runs")
    return s


def snapshot(lake_dir, rider, path):
    """Copy rider's runs out of the lake into the parquet file path."""
    sql = (f"use lake; copy ({SNAPSHOT_SQL.format(rider=sql_str(rider))}) "
           f"to {sql_str(path)} (format parquet);")
    r = subprocess.run(["duckdb", "--init", "init.sql", "-c", sql], cwd=lake_dir,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.returncode != 0:
        raise AskError(f"couldn't read the runs: {r.stdout.strip()[-300:]}")


def sandboxed(parquet, sql, duckdb="duckdb"):
    """Rows of sql over table runs (from parquet), in a fresh in-memory
    duckdb that can read no other file once runs is loaded."""
    script = (f"create table runs as from read_parquet({sql_str(parquet)});\n"
              "set enable_external_access = false;\n"
              "set lock_configuration = true;\n"
              f"{one_select(sql)};\n")
    r = subprocess.run([duckdb, "-init", os.devnull, "-json", "-c", script],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
    if r.returncode != 0:
        raise AskError((r.stderr or r.stdout).strip()[-300:])
    out = r.stdout.strip()
    try:
        return json.loads(out[out.rfind("\n[") + 1:] if "\n[" in out else out or "[]")
    except json.JSONDecodeError:
        raise AskError(f"couldn't read the rows: {out[:200]}")


# --- changes ----------------------------------------------------------------

def check_set(fields, resolve_foil):
    """fields with foil matched to a known foil, else AskError."""
    if not fields:
        raise AskError("the change sets nothing")
    out = {}
    for k, v in fields.items():
        if k not in EDITABLE:
            raise AskError(f"{k} can't be changed here")
        if v is None or isinstance(v, (dict, list)):
            raise AskError(f"{k} needs a value")
        v = str(v).strip()
        if EDITABLE[k] and v not in EDITABLE[k]:
            raise AskError(f"{k} must be one of {', '.join(sorted(EDITABLE[k]))}")
        if k == "foil":
            v, why = resolve_foil(v)
            if why:
                raise AskError(why)
        out[k] = v
    return out


def apply_sql(rider, ids, fields, request):
    """One lake commit setting fields on rider's runs ids."""
    sets = ", ".join(f"{k} = {sql_str(v)}" for k, v in fields.items())
    which = ", ".join(sql_str(i) for i in ids)
    msg = f"matrix-bot ask ({rider}): {request}"[:200]
    return ("use lake; begin; "
            f"call lake.set_commit_message('dustin', {sql_str(msg)}); "
            f"update dwlist set {sets} where rider = {sql_str(rider)} "
            f"and id::varchar in ({which}); commit;")


def run_line(r):
    """A run picked for a change, in a line: 3 Oct 2025 07:12 Maliko → Kanaha 12.3 km."""
    from datetime import date
    d = date.fromisoformat(str(r["date"])[:10])
    km = r.get("distance_km")
    return (f"{d.day} {d:%b %Y} {str(r.get('time') or '')[:5]} "
            f"{r.get('start_beach') or '?'} → {r.get('end_beach') or '?'}"
            + (f" {km:.1f} km" if isinstance(km, (int, float)) else ""))


def main():
    """Try a question against the lake without the bot, writing nothing:
    ./ask.py [--model M] [--ollama URL] walter 'the 2 runs with an unknown foil were the ART 999'"""
    import argparse
    import tempfile
    from datetime import datetime
    from zoneinfo import ZoneInfo
    ap = argparse.ArgumentParser(description=main.__doc__)
    ap.add_argument("--ollama", default="http://localhost:11434")
    ap.add_argument("--model", default="qwen3-coder-next:latest")
    ap.add_argument("rider")
    ap.add_argument("question", nargs="+")
    a = ap.parse_args()
    lake = os.environ.get("LAKE") or os.path.expanduser("~/stuff/duck")
    question = " ".join(a.question)
    with tempfile.TemporaryDirectory() as tmp:
        parquet = os.path.join(tmp, "runs.parquet")
        snapshot(lake, a.rider, parquet)
        distinct = lambda col: ", ".join(r["v"] for r in sandboxed(
            parquet, f"select distinct {col} as v from runs where {col} is not null order by 1"))
        context = {"today": f"{datetime.now(ZoneInfo('Pacific/Honolulu')):%A %Y-%m-%d}",
                   "beaches": distinct("start_beach") + ", " + distinct("end_beach"),
                   "foils": distinct("foil"), "boards": distinct("board")}
        p, rows = plan(a.ollama, a.model, question, context, parquet)
        print(json.dumps(p, indent=2))
        if rows is not None:
            print(json.dumps(rows[:20], indent=2, default=str))
            if p["kind"] == "query":
                print(answer(a.ollama, a.model, question, p["sql"], rows))


if __name__ == "__main__":
    main()
