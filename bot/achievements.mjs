#!/usr/bin/env node
// A rider's achievements as JSON, computed by the web's own code
// (web/lib/components/achievements.js) so the bot and the site agree.
//
//   node achievements.mjs runs.csv            every run with records, newest first
//   node achievements.mjs runs.csv --run ID   just that run's records
//
// runs.csv is the rider's list as db/export-lists.sql writes it (the file
// the site reads from the CDN). Each run is
//   {run_id, ts, records: [{category, label, group, value, display,
//    matched, event, note, prev: {value, display, run_id, ts},
//    beaten_by: {run_id, ts}}]}
// with ts in ISO 8601; prev and beaten_by are null when there's none.
//
// The web code imports npm:d3 and observablehq:stdlib, which mean
// something only to Observable Framework, so a loader hook maps npm:d3 to
// d3's UMD bundle (DWP_D3, set by bot-env.nix; else fetched once from
// jsDelivr into ~/.cache/dwp) and the stdlib to a stub.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire, register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.TZ ||= 'Pacific/Honolulu'; // streaks and months are local days
globalThis.location ??= new URL('https://dustin.downwind.pro/'); // data.js reads it

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS = path.join(HERE, '..', 'web', 'lib', 'components');
const D3_URL = 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js';

async function d3Path() {
  if (process.env.DWP_D3) return process.env.DWP_D3;
  const cached = path.join(os.homedir(), '.cache', 'dwp', 'd3-7.9.0.min.js');
  if (!fs.existsSync(cached)) {
    const res = await fetch(D3_URL);
    if (!res.ok) throw new Error(`${D3_URL}: ${res.status}`);
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
  }
  return cached;
}

const hooks = `
let names;
export function initialize(data) { names = data.names; }
export function resolve(spec, ctx, next) {
  if (spec === 'npm:d3' || spec === 'observablehq:stdlib')
    return { url: 'dwp-shim:' + spec, shortCircuit: true };
  return next(spec, ctx);
}
export function load(url, ctx, next) {
  if (url === 'dwp-shim:npm:d3') {
    return { format: 'module', shortCircuit: true, source:
      'const d3 = globalThis.dwpD3; export const { ' + names.join(', ') + ' } = d3; export default d3;' };
  }
  if (url === 'dwp-shim:observablehq:stdlib')
    return { format: 'module', shortCircuit: true, source: 'export const FileAttachment = () => { throw new Error("no FileAttachment in node"); };' };
  return next(url, ctx);
}
`;

function usage() {
  console.error('usage: achievements.mjs runs.csv [--run ID]');
  process.exit(2);
}

const args = process.argv.slice(2);
const runIdx = args.indexOf('--run');
const onlyRun = runIdx >= 0 ? args.splice(runIdx, 2)[1] : null;
if (args.length !== 1 || (runIdx >= 0 && !onlyRun)) usage();

const d3 = (globalThis.dwpD3 = createRequire(import.meta.url)(await d3Path()));
register('data:text/javascript,' + encodeURIComponent(hooks), {
  data: { names: Object.keys(d3).filter(k => /^[A-Za-z_$][\w$]*$/.test(k)) },
});
const { fetchMeta } = await import(pathToFileURL(path.join(COMPONENTS, 'data.js')));
const { computeAchievements } = await import(pathToFileURL(path.join(COMPONENTS, 'achievements.js')));

const text = fs.readFileSync(args[0], 'utf8');
const runs = await fetchMeta(() => ({ csv: ({ typed } = {}) => Promise.resolve(d3.csvParse(text, typed ? d3.autoType : undefined)) }));

const iso = d => d.toISOString();
const ref = r => r && { run_id: String(r.run.id), ts: iso(r.run.ts) };
const out = computeAchievements(runs)
  .filter(a => onlyRun == null || String(a.run.id) === onlyRun)
  .map(({ run, records }) => ({
    run_id: String(run.id),
    ts: iso(run.ts),
    records: records.map(r => ({
      category: r.category.key,
      label: r.category.label,
      group: r.group ?? null,
      value: r.value,
      display: r.category.fmt(r.value),
      matched: r.matched,
      event: !!r.category.event,
      note: r.note ?? null,
      prev: r.prevRecord ? { value: r.prev, display: r.category.fmt(r.prev), ...ref(r.prevRecord) } : null,
      beaten_by: ref(r.beatenBy) ?? null,
    })),
  }));
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
