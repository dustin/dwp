// run-backend-availability-test.js
// For every run id in src/data/runs.csv, verify the backend actually has a
// published track file. This catches runs that are listed in the CSV but
// whose track data was never uploaded (or was later removed).

import fs from 'fs';
import path from 'path';
import { csvParse } from 'd3-dsv';

const DATAHOST = process.env.DATAHOST || 'd2qwe1xndvncw9.cloudfront.net';
const CONCURRENCY = Number(process.env.CONCURRENCY || 20);
const RUNS_CSV = path.join(process.cwd(), 'src/data/runs.csv');

function runDataURL(id) {
  return `https://${DATAHOST}/runs/dwid%3D${id}/data.csv`;
}

// Run a pool of `limit` concurrent workers over `items`, calling `fn` on each.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function checkRun(id) {
  const url = runDataURL(id);
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return { id, url, ok: response.ok, status: response.status };
  } catch (error) {
    return { id, url, ok: false, status: null, error: error.message };
  }
}

async function main() {
  const csvText = fs.readFileSync(RUNS_CSV, 'utf8');
  const rows = csvParse(csvText);
  const ids = [...new Set(rows.map(r => r.id).filter(Boolean))];

  console.log(`Checking ${ids.length} run ids against ${DATAHOST} (concurrency ${CONCURRENCY})...`);

  const results = await mapWithConcurrency(ids, CONCURRENCY, checkRun);

  const failures = results.filter(r => !r.ok);

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} of ${ids.length} runs have no published track on the backend:`);
    failures.forEach(f => {
      console.error(`  - ${f.id}: ${f.status ?? 'error'} ${f.error ?? ''} (${f.url})`);
    });
    process.exit(1);
  }

  console.log(`\n✅ All ${ids.length} runs have a published track on the backend.`);
  process.exit(0);
}

main().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
