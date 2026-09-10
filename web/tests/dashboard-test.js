// dashboard-test.js
// Simple test to verify dashboard loads and links work without errors

import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Wind/swell CSVs live on the external data host and simply don't exist for
// some runs/days. The app catches those fetch failures (data.js fetchWind /
// fetchSwell / fetchSwell2) and renders "No data" UI, but the browser still
// logs one "Failed to load resource ... 404" console error per missing file.
// Chromium's console text doesn't name the failed resource, so scoping is
// done by URL: each 404 response on an optional-data path excuses exactly
// one subsequent 404 console message (the response event fires first).
// Only these exact shapes are excused:
//   https://d2qwe1xndvncw9.cloudfront.net/wind/site%3D<site>/day%3D<day>/data.csv
//   https://d2qwe1xndvncw9.cloudfront.net/swell/site%3D<site>/day%3D<day>/data.csv
//   https://d2qwe1xndvncw9.cloudfront.net/swell_partition/site%3D<site>/day%3D<day>/data.csv
// The track CSV (/runs/...) is deliberately excluded -- a missing track is
// a real failure.
function isOptionalDataRequest(url) {
  return /^https:\/\/d2qwe1xndvncw9\.cloudfront\.net\/(wind|swell|swell_partition)\/site%3D[^/]+\/day%3D[^/]+\/data\.csv$/.test(
    url
  );
}

function isMissingDataNoise(text) {
  return /Failed to load resource:.*\b404\b/.test(text);
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
    bucket.push(`Request failed: ${request.url()}`);
  });
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
  const fs = await import('fs');
  const path = await import('path');
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

  // Save screenshot and HTML of index page
  await page.screenshot({ path: `${outputDir}/index-page.png`, fullPage: true });
  const indexHtml = await page.content();
  fs.writeFileSync(`${outputDir}/index-page.html`, indexHtml);
  console.log(`📸 Saved screenshot to ${outputDir}/index-page.png`);
  console.log(`📄 Saved HTML to ${outputDir}/index-page.html`);

  if (errors.length > 0) {
    console.error('❌ Errors on index page:');
    errors.forEach(err => console.error('  -', err));
    await browser.close();
    process.exit(1);
  }

  console.log('✓ Index page loaded successfully');

  // Find all links on the page
  const links = await page.evaluate(baseUrl => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter(
        href => href.startsWith(baseUrl) && !href.includes('#') // Skip anchor links
      );
  }, BASE_URL);

  // Get unique links and randomly sample them
  const uniqueLinks = [...new Set(links)];
  const sampleSize = Math.min(5, uniqueLinks.length); // Test up to 5 random links
  const shuffled = uniqueLinks.sort(() => Math.random() - 0.5);
  const sampledLinks = shuffled.slice(0, sampleSize);

  console.log(
    `Found ${uniqueLinks.length} unique links, testing ${sampledLinks.length} random samples`
  );

  const level2Links = []; // Collect links from sampled pages for second level

  // Test each sampled link (Level 1)
  for (const link of sampledLinks) {
    if (testedUrls.has(link)) continue;

    console.log(`Testing: ${link}`);
    const linkErrors = [];

    // Create new page context for each link
    const linkPage = await context.newPage();

    attachErrorListeners(linkPage, linkErrors);

    try {
      await linkPage.goto(link, { waitUntil: 'networkidle', timeout: 10000 });
      await linkPage.waitForTimeout(2000);

      // Save screenshot of subpage
      const sanitizedUrl = link.replace(/[^a-z0-9]/gi, '_');
      await linkPage.screenshot({ path: `${outputDir}/${sanitizedUrl}.png`, fullPage: true });
      const linkHtml = await linkPage.content();
      fs.writeFileSync(`${outputDir}/${sanitizedUrl}.html`, linkHtml);

      if (linkErrors.length > 0) {
        console.error(`  ❌ Errors on ${link}:`);
        linkErrors.forEach(err => console.error('    -', err));
        console.error(`  📸 Screenshot saved to ${outputDir}/${sanitizedUrl}.png`);
        errors.push(...linkErrors);
      } else {
        console.log(`  ✓ ${link} loaded successfully`);

        // Collect links from this page for level 2 testing
        const pageLinks = await linkPage.evaluate(baseUrl => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(href => href.startsWith(baseUrl) && !href.includes('#'));
        }, BASE_URL);
        level2Links.push(...pageLinks);
      }
    } catch (error) {
      console.error(`  ❌ Failed to load ${link}: ${error.message}`);
      errors.push(`Failed to load ${link}: ${error.message}`);
    }

    await linkPage.close();
    testedUrls.add(link);
  }

  // Test Level 2 links (links from the sampled pages)
  const uniqueLevel2Links = [...new Set(level2Links)].filter(link => !testedUrls.has(link));

  if (uniqueLevel2Links.length > 0) {
    const level2SampleSize = Math.min(25, uniqueLevel2Links.length);
    const shuffledLevel2 = uniqueLevel2Links.sort(() => Math.random() - 0.5);
    const sampledLevel2Links = shuffledLevel2.slice(0, level2SampleSize);

    console.log(
      `\nFound ${uniqueLevel2Links.length} level 2 links, testing ${sampledLevel2Links.length} random samples`
    );

    for (const link of sampledLevel2Links) {
      console.log(`Testing (level 2): ${link}`);
      const linkErrors = [];

      const linkPage = await context.newPage();

      attachErrorListeners(linkPage, linkErrors);

      try {
        await linkPage.goto(link, { waitUntil: 'networkidle', timeout: 10000 });
        await linkPage.waitForTimeout(2000);

        const sanitizedUrl = 'level2_' + link.replace(/[^a-z0-9]/gi, '_');
        await linkPage.screenshot({ path: `${outputDir}/${sanitizedUrl}.png`, fullPage: true });
        const linkHtml = await linkPage.content();
        fs.writeFileSync(`${outputDir}/${sanitizedUrl}.html`, linkHtml);

        if (linkErrors.length > 0) {
          console.error(`  ❌ Errors on ${link}:`);
          linkErrors.forEach(err => console.error('    -', err));
          console.error(`  📸 Screenshot saved to ${outputDir}/${sanitizedUrl}.png`);
          errors.push(...linkErrors);
        } else {
          console.log(`  ✓ ${link} loaded successfully`);
        }
      } catch (error) {
        console.error(`  ❌ Failed to load ${link}: ${error.message}`);
        errors.push(`Failed to load ${link}: ${error.message}`);
      }

      await linkPage.close();
      testedUrls.add(link);
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
