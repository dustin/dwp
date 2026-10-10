// dashboard-test.js
// Simple test to verify dashboard loads and links work without errors

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { csvParse } from 'd3-dsv';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const RUNS_CSV = process.env.RUNS_CSV || path.join(process.cwd(), 'rider/data/runs.csv');
// How many of the newest runs to always test, so a bad recent import shows
// up right away instead of whenever the random sample happens to hit it.
const RECENT_RUNS = Number(process.env.RECENT_RUNS || 3);

// Pages that are always tested, in addition to the random sample below.
function requiredLinks() {
  const rows = csvParse(fs.readFileSync(RUNS_CSV, 'utf8'));
  const recent = rows
    .filter(r => r.id)
    .sort((a, b) => Number(b.ts) - Number(a.ts))
    .slice(0, RECENT_RUNS)
    .map(r => `${BASE_URL}/run.html?id=${r.id}`);
  return [`${BASE_URL}/buoy.html`, `${BASE_URL}/foils.html`, ...recent];
}

// Wind/swell CSVs live on the external data host and simply don't exist for
// some runs/days. The app catches those fetch failures (data.js fetchWind /
// fetchSwell / fetchCsvForDay) and renders "No data" UI, but the browser still
// logs one "Failed to load resource ... 404" console error per missing file.
// Chromium's console text doesn't name the failed resource, so scoping is
// done by URL: each 404 response on an optional-data path excuses exactly
// one subsequent 404 console message (the response event fires first).
// Only these exact shapes are excused:
//   https://d2qwe1xndvncw9.cloudfront.net/wind/site%3D<site>/day%3D<day>/data.csv
//   https://d2qwe1xndvncw9.cloudfront.net/swell_partition/site%3D<site>/day%3D<day>/data.csv
//   https://d2qwe1xndvncw9.cloudfront.net/swell_spectrum/site%3D<site>/day%3D<day>/data.csv
//   https://d2qwe1xndvncw9.cloudfront.net/runs/rider%3D<rider>/(runs|crashes|run_buoy).csv
// (the last until the rider's lists are on the CDN; data.js riderFile falls
// back to the bundled copies).
// The track CSV (/runs/.../data.csv) is deliberately excluded -- a missing
// track is a real failure.
function isOptionalDataRequest(url) {
  return (
    /^https:\/\/d2qwe1xndvncw9\.cloudfront\.net\/(wind|swell_partition|swell_spectrum)\/site%3D[^/]+\/day%3D[^/]+\/data\.csv$/.test(
      url
    ) || /^https:\/\/d2qwe1xndvncw9\.cloudfront\.net\/runs\/rider%3D[a-z0-9-]+\/(runs|crashes|run_buoy)\.csv$/.test(url)
  );
}

function isMissingDataNoise(text) {
  return /Failed to load resource:.*\b404\b/.test(text);
}

// On GitHub Actions, also report a failing page as an annotation so it shows
// on the run summary without digging through the log.
function annotate(link, messages) {
  if (!process.env.GITHUB_ACTIONS) return;
  const first = messages.slice(0, 3).join(' | ').replace(/\r?\n/g, ' ');
  console.log(`::error title=${link.replace(/[:,]/g, ' ')}::${first}`);
}

function attachErrorListeners(pg, bucket) {
  // Count of un-attributed 404s on optional-data paths. Each excuses one
  // subsequent "Failed to load resource ... 404" console message.
  let excusedPending = 0;

  pg.on('response', response => {
    if (response.status() === 404 && isOptionalDataRequest(response.url())) {
      excusedPending++;
      console.log(`  (ignoring missing-data 404: ${response.url()})`);
      return;
    }
    // Same-origin failures stay fatal: our own pages and assets must load.
    if (response.url().startsWith(BASE_URL) && response.status() >= 400) {
      bucket.push(`Bad same-origin response: ${response.status()} ${response.url()}`);
    }
  });

  pg.on('console', msg => {
    if (msg.type() !== 'error') return;
    if (isMissingDataNoise(msg.text()) && excusedPending > 0) {
      excusedPending--;
      return;
    }
    const location = msg.location();
    bucket.push(
      `Console error: ${msg.text()} (at ${location.url}:${location.lineNumber}:${location.columnNumber})`
    );
  });

  pg.on('pageerror', error => {
    bucket.push(`Page error: ${error.message}\nStack: ${error.stack}`);
  });

  pg.on('requestfailed', request => {
    const reason = request.failure()?.errorText ?? 'unknown';
    // Third-party fetches (Mapbox tiles/styles) get cancelled when the map
    // re-renders or the page closes; that isn't a site error.
    if (reason === 'net::ERR_ABORTED' && !request.url().startsWith(BASE_URL)) {
      console.log(`  (ignoring aborted third-party request: ${request.url()})`);
      return;
    }
    bucket.push(`Request failed (${reason}): ${request.url()}`);
  });
}

// Sections below the fold render only when scrolled near (components/lazy.js),
// so walk down the page until nothing new appears. This also exercises those
// sections for errors before the full-page screenshot.
async function renderLazySections(pg) {
  for (let i = 0; i < 50; i++) {
    const atBottom = await pg.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
      return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
    });
    await pg.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await pg.waitForTimeout(300);
    if (atBottom && (await pg.evaluate(
      () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1
    ))) break;
  }
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.waitForTimeout(500);
}

async function runTests() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    permissions: ['geolocation'],
  });

  const page = await context.newPage();

  const errors = [];
  const testedUrls = new Set();

  // Create output directory for screenshots and HTML
  const outputDir = path.join(process.cwd(), 'test-output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Listen for console errors, page errors, and failed requests.
  attachErrorListeners(page, errors);

  console.log(`Testing index page at ${BASE_URL}...`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  testedUrls.add(BASE_URL);

  // Wait a bit for any graphs to render
  await page.waitForTimeout(2000);
  await renderLazySections(page);

  // Save screenshot and HTML of index page
  await page.screenshot({ path: `${outputDir}/index-page.png`, fullPage: true });
  const indexHtml = await page.content();
  fs.writeFileSync(`${outputDir}/index-page.html`, indexHtml);
  console.log(`📸 Saved screenshot to ${outputDir}/index-page.png`);
  console.log(`📄 Saved HTML to ${outputDir}/index-page.html`);

  if (errors.length > 0) {
    console.error('❌ Errors on index page:');
    errors.forEach(err => console.error('  -', err));
    annotate(BASE_URL, errors);
    await browser.close();
    process.exit(1);
  }

  console.log('✓ Index page loaded successfully');

  // Find all links on the page
  const links = await page.evaluate(baseUrl => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => new URL(a.getAttribute('href'), document.baseURI).href) // SVG <a> has no string .href
      .filter(
        href => href.startsWith(baseUrl) && !href.includes('#') // Skip anchor links
      );
  }, BASE_URL);

  // Load one page, record its errors, and return the same-origin links on it
  // (or none if it failed).
  async function testPage(link, prefix = '') {
    console.log(`Testing${prefix ? ` (${prefix})` : ''}: ${link}`);
    const linkErrors = [];
    const linkPage = await context.newPage();
    attachErrorListeners(linkPage, linkErrors);
    let pageLinks = [];

    try {
      await linkPage.goto(link, { waitUntil: 'networkidle', timeout: 10000 });
      await linkPage.waitForTimeout(2000);
      await renderLazySections(linkPage);

      // Save screenshot of subpage
      const sanitizedUrl = (prefix ? `${prefix}_` : '') + link.replace(/[^a-z0-9]/gi, '_');
      await linkPage.screenshot({ path: `${outputDir}/${sanitizedUrl}.png`, fullPage: true });
      const linkHtml = await linkPage.content();
      fs.writeFileSync(`${outputDir}/${sanitizedUrl}.html`, linkHtml);

      if (linkErrors.length > 0) {
        console.error(`  ❌ Errors on ${link}:`);
        linkErrors.forEach(err => console.error('    -', err));
        console.error(`  📸 Screenshot saved to ${outputDir}/${sanitizedUrl}.png`);
        annotate(link, linkErrors);
        errors.push(...linkErrors);
      } else {
        console.log(`  ✓ ${link} loaded successfully`);
        pageLinks = await linkPage.evaluate(baseUrl => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => new URL(a.getAttribute('href'), document.baseURI).href) // SVG <a> has no string .href
            .filter(href => href.startsWith(baseUrl) && !href.includes('#'));
        }, BASE_URL);
      }
    } catch (error) {
      console.error(`  ❌ Failed to load ${link}: ${error.message}`);
      annotate(link, [error.message.split('\n')[0]]);
      errors.push(`Failed to load ${link}: ${error.message}`);
    }

    await linkPage.close();
    testedUrls.add(link);
    return pageLinks;
  }

  const level2Links = []; // Collect links from level 1 pages for second level

  // Always test buoys, foils, and the most recent runs.
  const required = requiredLinks();
  console.log(`Testing ${required.length} required pages (buoy, foils, ${RECENT_RUNS} most recent runs)`);
  for (const link of required) {
    if (testedUrls.has(link)) continue;
    level2Links.push(...(await testPage(link, 'required')));
  }

  // Then a random sample of the rest of the index page's links.
  const uniqueLinks = [...new Set(links)].filter(link => !testedUrls.has(link));
  const sampleSize = Math.min(5, uniqueLinks.length); // Test up to 5 random links
  const shuffled = uniqueLinks.sort(() => Math.random() - 0.5);
  const sampledLinks = shuffled.slice(0, sampleSize);

  console.log(
    `\nFound ${uniqueLinks.length} other unique links, testing ${sampledLinks.length} random samples`
  );

  for (const link of sampledLinks) {
    if (testedUrls.has(link)) continue;
    level2Links.push(...(await testPage(link)));
  }

  // Test Level 2 links (links from the sampled pages)
  const uniqueLevel2Links = [...new Set(level2Links)].filter(link => !testedUrls.has(link));

  if (uniqueLevel2Links.length > 0) {
    const level2SampleSize = Math.min(10, uniqueLevel2Links.length);
    const shuffledLevel2 = uniqueLevel2Links.sort(() => Math.random() - 0.5);
    const sampledLevel2Links = shuffledLevel2.slice(0, level2SampleSize);

    console.log(
      `\nFound ${uniqueLevel2Links.length} level 2 links, testing ${sampledLevel2Links.length} random samples`
    );

    for (const link of sampledLevel2Links) {
      await testPage(link, 'level2');
    }
  }

  await browser.close();

  if (errors.length > 0) {
    console.error('\n❌ Tests failed with errors');
    process.exit(1);
  }

  console.log('\n✅ All tests passed!');
  process.exit(0);
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
