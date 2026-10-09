// Warm the browser cache for another page while this one is idle, so
// following a link to it skips most of its script downloads. Reads the
// page's own <link rel=modulepreload|stylesheet> list (Framework writes one
// per page, with hashed names) and prefetches those plus any `extra` URLs
// (e.g. a run's track data). Skipped when the browser asks to save data.
export function prefetchPage(page, { extra = [] } = {}) {
  if (navigator.connection?.saveData) return;
  const idle = window.requestIdleCallback ?? (f => setTimeout(f, 1000));
  const start = () => idle(() => run().catch(() => {}), { timeout: 5000 });
  if (document.readyState === 'complete') start();
  else addEventListener('load', start, { once: true });

  async function run() {
    const base = new URL(page, location.href);
    const html = await (await fetch(base, { priority: 'low' })).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const have = new Set([...document.querySelectorAll('link[href], script[src]')].map(e => (e.href || e.src)));
    const urls = [...doc.querySelectorAll('link[rel=modulepreload], link[rel=stylesheet]')]
      .map(l => new URL(l.getAttribute('href'), base).href)
      .filter(u => u.startsWith(location.origin) && !have.has(u));
    for (const href of [...urls, ...extra]) {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = href;
      // Match how the page will request it: modules and data are CORS
      // fetches, stylesheets aren't.
      if (!href.endsWith('.css')) link.crossOrigin = 'anonymous';
      document.head.append(link);
    }
  }
}
