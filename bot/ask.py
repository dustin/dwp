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

Only the Python standard library, like db/.
"""

import json
import os
import re
import subprocess
import urllib.request

# What the model sees of a run: table runs. Dates and times are Hawaii local.
RUN_COLUMNS = """\
rider varchar, id varchar, date date, time time, start_beach varchar, end_beach varchar,
region varchar, board varchar, foil varchar, foil_confidence varchar,
name varchar, description varchar, distance_km double,
distance_on_foil double, duration_sec double, duration_on_foil double,
avg_speed_kmh double, max_speed_1k double, avg_foiling_hr double,
max_hr double, paddle_up_count int"""

SNAPSHOT_SQL = """\
select rider, id::varchar as id, date, time, start_beach, end_beach, region, board,
       foil, foil_confidence, name, description, distance_km,
       distance_on_foil, duration_sec, duration_on_foil, avg_speed_kmh,
       max_speed_1k, avg_foiling_hr, max_hr, paddle_up_count
from dwlist_resolved where rider in ({riders})"""

# Runs that went together (as db/export-lists.sql's together.csv): same
# start beach, overlapping by at least ten minutes, among riders only.
TOGETHER_SQL = """\
select a.rider, a.id::varchar as id, b.rider as other_rider, b.id::varchar as other_id,
       round(least(a.ts + a.duration_sec, b.ts + b.duration_sec) - greatest(a.ts, b.ts)) as overlap_sec
from dwlist a join dwlist b
  on b.rider <> a.rider and b.start_pos = a.start_pos
 and b.ts < a.ts + a.duration_sec and a.ts < b.ts + b.duration_sec
where a.rider in ({riders}) and b.rider in ({riders})
  and least(a.ts + a.duration_sec, b.ts + b.duration_sec) - greatest(a.ts, b.ts) >= 600"""

# Fields a change may set, and the values each may take (None: any text).
EDITABLE = {"foil": None, "foil_confidence": {"high", "medium", "low"},
            "board": None, "name": None, "description": None}

SYSTEM = """\
You turn a downwind foil rider's message to a chat bot into JSON. The
rider asking is {me} ("I", "me", "my" mean {me}). The bot runs your SQL in
DuckDB over these tables, which hold only the runs of {riders}:

  runs({columns})
  together(rider, id, other_rider, other_id, overlap_sec): two riders' runs
    that went together (same start beach, overlapping in time), listed
    both ways round; join id to runs.id for the run's details.

Filter runs by rider for a question about one rider ("my longest run":
where rider = '{me}').

distance_km is km, distance_on_foil METRES (divide by 1000 for km),
duration_* seconds, speeds km/h (max_speed_1k is the fastest 1 km),
heart rates bpm. region is e.g. 'Kihei' or 'Maui North Shore'. Use
dayname(date) for days of the week (isodow(date) to order them, Monday
first) and monthname(date) for months. This is DuckDB, not MySQL. A run goes from start_beach to end_beach;
"went to X" means either one, and a loose place name means the closest
beach in the list below ("the harbor" is Kahului Harbor). foil is null or 'unknown' when not known.
Today is {today} (Hawaii). Beaches: {beaches}.
Their foils: {foils}. Boards: {boards}.

Answer with exactly one of:
  {{"kind": "query", "sql": "<one SELECT over runs answering the question>"}}
  {{"kind": "edit", "sql": "<one SELECT id FROM runs WHERE ... picking the runs to change>",
    "set": {{"<field>": "<value>", ...}}, "count": <how many runs the message says, or null>}}
  {{"kind": "unclear", "say": "<a short question back to the rider>"}}
An edit may set only: foil, foil_confidence ('high', 'medium' or 'low':
how sure the rider is of the foil), board, name, description. Write foil
as the rider wrote it; the bot matches it to a known foil. Use only the
columns above, and keep SELECTs to what the answer needs (at most 20 rows).
When the answer is particular runs (the first, the longest, last week's),
select their id too, so the bot can link them.
"""

ANSWER = """\
A rider asked: {question}
The bot ran this SQL over their runs:
{sql}
and got these rows (JSON): {rows}
Answer the rider in one or two short, plain sentences from those rows only.
Use 24-hour times without seconds, km to one decimal, and ISO 8601 dates
(2025-05-23). Don't mention ids; the bot links the runs itself. If there
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
                raise AskError(f"{e}\n(after {tries} tries) {p['sql']}")
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


def snapshot(lake_dir, riders, path):
    """Copy riders' runs, and which of them went together, out of the
    lake into the directory path (runs.parquet, together.parquet)."""
    who = ", ".join(map(sql_str, riders))
    sql = "use lake; " + "".join(
        f"copy ({q.format(riders=who)}) to {sql_str(os.path.join(path, name))} (format parquet); "
        for q, name in ((SNAPSHOT_SQL, "runs.parquet"), (TOGETHER_SQL, "together.parquet")))
    r = subprocess.run(["duckdb", "--init", "init.sql", "-c", sql], cwd=lake_dir,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if r.returncode != 0:
        raise AskError(f"couldn't read the runs: {r.stdout.strip()[-300:]}")


# MySQL's FIELD(x, a, b, ...): x's 1-based place among up to 12 values (0
# if absent), which models reach for to order weekdays and months.
FIELD_MACRO = ("create macro field(x, " + ", ".join(f"v{i} := null" for i in range(12))
               + ") as coalesce(list_position([" + ", ".join(f"v{i}" for i in range(12))
               + "], x), 0);")


def sandboxed(path, sql, duckdb="duckdb"):
    """Rows of sql over tables runs and together (from snapshot's path), in
    a fresh in-memory duckdb that can read no other file once they're loaded."""
    script = (f"create table runs as from read_parquet({sql_str(os.path.join(path, 'runs.parquet'))});\n"
              f"create table together as from read_parquet({sql_str(os.path.join(path, 'together.parquet'))});\n"
              f"{FIELD_MACRO}\n"
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

def check_set(fields, resolve_gear):
    """fields with foil and board matched to known ones (resolve_gear(kind,
    name) → (name, why)), else AskError."""
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
        if k in ("foil", "board"):
            v, why = resolve_gear(k, v)
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


def answered_runs(path, rows, me=None, most=5):
    """The runs (from snapshot path) that answer rows names, for links: by
    their ids, or, when the model left the id out, by each row's date (and
    rider and beaches, where given) when that finds just one run, or just
    one of me's."""
    ids = [r["id"] for r in rows if isinstance(r.get("id"), str)
           and re.fullmatch(r"[0-9a-f-]{36}", r["id"])]
    if not ids and len(rows) <= most:
        for r in rows:
            if not re.fullmatch(r"\d{4}-\d\d-\d\d", str(r.get("date", ""))[:10]):
                continue
            where = [f"date = {sql_str(str(r['date'])[:10])}"] + [
                f"{k} = {sql_str(r[k])}" for k in ("rider", "start_beach", "end_beach")
                if isinstance(r.get(k), str)]
            hit = sandboxed(path, "select id, rider from runs where " + " and ".join(where))
            if len(hit) > 1:
                hit = [h for h in hit if h["rider"] == me]
            if len(hit) == 1:
                ids.append(hit[0]["id"])
    if not ids:
        return []
    return sandboxed(path, "select * from runs where id in ("
                     + ", ".join(map(sql_str, ids[:most])) + ") order by date, time")


def link(path, r, together=False):
    """(line, url) linking run r: to together.html with the runs that went
    with it, when together and there are some, else to its run page."""
    url = f"https://{r['rider']}.downwind.pro/"
    others = sandboxed(path, f"select other_rider, other_id from together where id = {sql_str(r['id'])}"
                             " order by other_rider") if together else []
    if others:
        runs = ",".join([f"{r['rider']}:{r['id']}"] + [f"{o['other_rider']}:{o['other_id']}" for o in others])
        return (f"{run_line(r)} with {' and '.join(o['other_rider'] for o in others)}",
                f"{url}together.html?runs={runs}")
    return run_line(r), f"{url}run.html?id={r['id']}"


def cell(v):
    """A result value for a table: floats to one decimal, times to the minute."""
    if isinstance(v, float):
        return f"{v:.1f}"
    if v is None:
        return ""
    v = str(v)
    return v[:5] if re.fullmatch(r"\d\d:\d\d:\d\d(\.\d+)?", v) else v


def table(rows, most=10):
    """(text, html) of the first most rows as a table (ids left out), or
    None for a single row, which the answer already says."""
    if len(rows) < 2:
        return None
    cols = [c for c in rows[0] if c not in ("id", "other_id")]
    if not cols:
        return None
    body = [[cell(r.get(c)) for c in cols] for r in rows[:most]]
    more = f"… {len(rows) - most} more rows" if len(rows) > most else ""
    w = [max(len(c), *(len(b[i]) for b in body)) for i, c in enumerate(cols)]
    text = "\n".join(["  ".join(c.ljust(w[i]) for i, c in enumerate(cols)),
                      *("  ".join(v.ljust(w[i]) for i, v in enumerate(b)) for b in body)]
                     + ([more] if more else []))
    esc = lambda x: x.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    html = ("<table><tr>" + "".join(f"<th>{esc(c)}</th>" for c in cols) + "</tr>"
            + "".join("<tr>" + "".join(f"<td>{esc(v)}</td>" for v in b) + "</tr>" for b in body)
            + "</table>" + (f"<i>{esc(more)}</i>" if more else ""))
    return text, html


def run_line(r):
    """A run in a line: 2025-10-03 07:12 Maliko → Kanaha 12.3 km."""
    km = r.get("distance_km")
    return (f"{str(r['date'])[:10]} {str(r.get('time') or '')[:5]} "
            f"{r.get('start_beach') or '?'} → {r.get('end_beach') or '?'}"
            + (f" {km:.1f} km" if isinstance(km, (int, float)) else ""))


def context(path, me, riders, beaches):
    """What SYSTEM needs besides the columns, for snapshot path."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    distinct = lambda col: ", ".join(r["v"] for r in sandboxed(
        path, f"select distinct {col} as v from runs where {col} is not null order by 1"))
    return {"me": me, "riders": " and ".join(riders),
            "today": f"{datetime.now(ZoneInfo('Pacific/Honolulu')):%A %Y-%m-%d}",
            "beaches": ", ".join(beaches), "foils": distinct("foil"), "boards": distinct("board")}


def main():
    """Try a question against the lake without the bot, writing nothing:
    bot/ask.py [--model M] [--ollama URL] walter 'the 2 runs with an unknown foil were the ART 999'
    bot/ask.py dustin,walter 'when did walter and I first go together?' (the first rider asks)"""
    import argparse
    import tempfile
    ap = argparse.ArgumentParser(description=main.__doc__)
    ap.add_argument("--ollama", default="http://localhost:11434")
    ap.add_argument("--model", default="qwen3-coder-next:latest")
    ap.add_argument("riders")
    ap.add_argument("question", nargs="+")
    a = ap.parse_args()
    lake = os.environ.get("LAKE") or os.path.expanduser("~/stuff/duck")
    question, riders = " ".join(a.question), a.riders.split(",")
    with tempfile.TemporaryDirectory() as tmp:
        snapshot(lake, riders, tmp)
        beaches = [r["v"] for r in sandboxed(
            tmp, "select distinct start_beach as v from runs union select end_beach from runs")]
        p, rows = plan(a.ollama, a.model, question, context(tmp, riders[0], riders, beaches), tmp)
        print(json.dumps(p, indent=2))
        if rows is not None:
            print(json.dumps(rows[:20], indent=2, default=str))
            if p["kind"] == "query":
                print(answer(a.ollama, a.model, question, p["sql"], rows))


if __name__ == "__main__":
    main()
