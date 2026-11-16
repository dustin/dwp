// ==UserScript==
// @name         Waterspeed GPX bulk export
// @namespace    waterspeed-gpx-export
// @version      0.2.1
// @description  Collect the GPX file for every activity in the current Waterspeed list and save them as one zip.
// @homepageURL  https://downwind.pro/import.html
// @downloadURL  https://downwind.pro/waterspeed-gpx-export.user.js
// @updateURL    https://downwind.pro/waterspeed-gpx-export.user.js
// @match        https://go.waterspeedapp.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @grant        none
// @inject-into  page
// @run-at       document-start
// ==/UserScript==

/*
 * How it works
 * ------------
 * The Waterspeed web app builds each GPX file in the browser and "downloads"
 * it by clicking a temporary <a download href="data:application/gpx...">.
 * While this script is running it intercepts those clicks, keeps the GPX text
 * instead of triggering a download, and saves the files as zip parts of 50
 * (each GPX is ~1 MB), so there's one Save prompt per 50 activities instead
 * of one per activity.
 *
 * Waterspeed's activity list is virtualized: only ~40 cards exist on the page
 * at a time, inside their own scrolling box. So the list is walked by activity
 * (each card's date/time label), not by position, and after each activity the
 * script jumps back to where it was in the list.
 *
 * Usage: open Activities, set the filter (e.g. Downwind / All time), then use
 * the panel in the bottom-right corner. Don't reload the page mid-run: files
 * not yet saved in a zip part are lost. "Save zip" saves whatever is pending
 * at any point, including after Stop, and pressing Resume continues where it
 * left off.
 */
(() => {
  'use strict';

  const CARD_RE = /^\d{2} \w{3} \d{4} at \d{1,2}:\d{2}/; // "30 Jul 2026 at 01:26 PM"
  const ID_RE = /\/activity\/([0-9a-z-]+)/;
  // Each GPX is ~1 MB+ of text, so save a zip part every BATCH files instead of
  // holding hundreds in memory.
  const BATCH = 50;

  const state = {
    capturing: false,   // intercept GPX downloads only while running
    running: false,
    stop: false,
    pending: null,      // resolver waiting for the next captured GPX
    files: [],          // { name, text } not yet saved in a zip part
    part: 0,            // zip parts saved so far
    ids: new Set(),     // activity IDs collected
    done: new Set(),    // card labels already handled (collected, skipped or failed)
    failed: [],         // labels that produced no GPX
    expected: null,     // "You did N activities" for the current filter, if shown
  };

  // --- Intercept the app's GPX downloads -----------------------------------

  // Remember Blobs so blob: URL downloads can be read even after revoke.
  const blobs = new Map();
  const origCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (obj) {
    const url = origCreateObjectURL.call(URL, obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };

  const isGpx = (a) =>
    !!a && typeof a.href === 'string' &&
    (a.href.startsWith('data:application/gpx') ||
     (a.href.startsWith('blob:') && /\.gpx$/i.test(a.download || '')));

  async function grab(a) {
    let text;
    if (a.href.startsWith('data:')) {
      const comma = a.href.indexOf(',');
      const meta = a.href.slice(0, comma);
      const data = a.href.slice(comma + 1);
      text = /;base64/i.test(meta)
        ? new TextDecoder().decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))
        : decodeURIComponent(data);
    } else {
      const b = blobs.get(a.href);
      text = b ? await b.text() : await (await fetch(a.href)).text();
    }
    const resolve = state.pending;
    state.pending = null;
    if (resolve) resolve({ name: a.download || 'activity.gpx', text });
  }

  // a.click() on a detached anchor never reaches a listener, so patch it too.
  const origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (state.capturing && isGpx(this)) { grab(this); return; }
    return origAnchorClick.call(this);
  };
  window.addEventListener('click', (e) => {
    if (!state.capturing) return;
    const a = e.target instanceof Element ? e.target.closest('a') : null;
    if (isGpx(a)) { e.preventDefault(); e.stopImmediatePropagation(); grab(a); }
  }, true);

  // --- Page helpers ---------------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const human = (lo = 2000, hi = 5000) => sleep(lo + Math.random() * (hi - lo));

  async function waitFor(fn, timeout = 15000, step = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  const inPanel = (el) => !!el.closest('#wsgpx-panel');
  const shown = (el) => el.getClientRects().length > 0;

  function leaves(pred) {
    return [...document.querySelectorAll('body *')].filter(
      (el) => el.childElementCount === 0 && !inPanel(el) && pred(el.textContent.trim(), el));
  }
  const cards = () => leaves((t) => CARD_RE.test(t));
  const keyOf = (card) => card.textContent.trim();
  const byText = (text) => leaves((t, el) => t === text && shown(el))[0];
  const onList = () => location.pathname.startsWith('/activities');

  function readExpected() {
    const m = document.body.innerText.match(/You did (\d+) activit/);
    return m ? parseInt(m[1], 10) : null;
  }

  // The element that actually scrolls the list. Waterspeed's list is virtualized
  // (only ~40 cards exist at a time) inside its own scrolling box, so pick the
  // scrollable ancestor with the most room to scroll, falling back to the page.
  function scroller(el) {
    let best = null, room = 10;
    for (let n = el && el.parentElement; n && n !== document.body; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      const r = n.scrollHeight - n.clientHeight;
      if ((oy === 'auto' || oy === 'scroll') && r > room) { best = n; room = r; }
    }
    return best || document.scrollingElement || document.documentElement;
  }

  function scrollListTo(sc, top) {
    sc.scrollTo({ top: Math.max(0, top) });
    sc.dispatchEvent(new Event('scroll')); // make the virtualized list re-render
  }

  function clickLoadMore() {
    const b = [...document.querySelectorAll('button, a, [role="button"]')].find((el) =>
      !inPanel(el) && shown(el) && /^(load|show|see|view) more/i.test(el.textContent.trim()));
    if (b) { b.click(); return true; }
    return false;
  }

  // First card on the page that hasn't been handled yet, scrolling down as needed.
  // Returns null once scrolling stops turning up anything new (~12 s of patience).
  async function nextCard(skip) {
    let idle = 0;
    while (idle < 8) {
      for (const c of cards()) {
        const k = keyOf(c);
        if (state.done.has(k)) continue;
        if (skip.left > 0) { state.done.add(k); skip.left--; continue; }
        return c;
      }
      const all = cards();
      const seen = new Set(all.map(keyOf));
      const sc = scroller(all.at(-1));
      const before = sc.scrollTop;
      if (!clickLoadMore()) scrollListTo(sc, before + Math.max(400, sc.clientHeight * 0.8));
      await sleep(1500);
      const grew = cards().some((c) => !seen.has(keyOf(c)));
      idle = grew || sc.scrollTop !== before ? 0 : idle + 1;
    }
    return null;
  }

  async function downloadGpx() {
    const got = new Promise((res) => { state.pending = res; });
    for (let attempt = 0; attempt < 3; attempt++) {
      const menu = await waitFor(() => document.querySelector('img[src*="icon-hamburger"]'));
      if (!menu) break;
      window.scrollTo(0, 0);
      menu.click();
      const item = await waitFor(() => byText('Download GPX file'), 4000);
      if (!item) continue; // menu may have toggled closed; try again
      await human(500, 1200);
      item.click();
      const file = await Promise.race([got, sleep(20000).then(() => null)]);
      state.pending = null;
      return file;
    }
    state.pending = null;
    return null;
  }

  // Return to the list and jump back near where we were, so reaching activity
  // #400 doesn't mean scrolling past the first 399 every time. Restore a little
  // above the saved spot (card heights vary); handled cards are skipped anyway.
  async function goBack(savedTop) {
    const back = document.querySelector('img[src*="icon-arrow-left"]');
    if (back) back.click(); else history.back(); // in-app back keeps the filter
    await waitFor(() => onList() && cards().length > 0, 20000);
    await sleep(800);
    if (savedTop != null) {
      scrollListTo(scroller(cards()[0]), savedTop - 800);
      await sleep(1500);
    }
  }

  // --- Main loop ------------------------------------------------------------

  async function run(skipFirst, count) {
    if (!onList()) { log('Open the Activities list first.'); return; }
    state.running = true; state.stop = false; state.capturing = true;
    state.expected = readExpected() ?? state.expected;
    updateButtons();
    // "Skip first" only applies to a fresh start; a resumed run continues where it stopped.
    const skip = { left: state.done.size ? 0 : skipFirst };
    let done = 0, failures = 0;
    try {
      if (!state.done.size) { // fresh start: begin at the top of the list
        scrollListTo(scroller(cards()[0]), 0);
        await sleep(1500);
      }
      while (count == null || done < count) {
        if (state.stop) { log(`Stopped. ${summary()}`); break; }

        const card = await nextCard(skip);
        if (!card) { log(`Reached the end of the list. ${summary()}`); break; }
        const label = keyOf(card);
        state.done.add(label);

        card.scrollIntoView({ block: 'center' });
        const listTop = scroller(card).scrollTop;
        await human(800, 1600);
        card.click();

        const id = await waitFor(() => (location.pathname.match(ID_RE) || [])[1]);
        if (!id) {
          state.failed.push(label);
          log(`✗ ${label} didn't open`);
          if (++failures >= 3) { log(`Three failures in a row. Stopping. ${summary()}`); break; }
          continue; // still on the list
        }

        if (state.ids.has(id)) {
          log(`${label} already collected`);
        } else {
          await human();
          const f = await downloadGpx();
          if (f) {
            const stem = f.name.replace(/\.gpx$/i, '').replace(/[\/\\:]/g, '-');
            state.files.push({ name: `${stem} [${id}].gpx`, text: f.text });
            state.ids.add(id);
            failures = 0;
            log(`✓ ${stem} — ${summary()}`);
            if (state.files.length >= BATCH) await saveZip();
          } else {
            state.failed.push(label);
            log(`✗ no GPX for ${label}`);
            if (++failures >= 3) { log(`Three failures in a row. Stopping. ${summary()}`); break; }
          }
        }
        done++;

        await human();
        await goBack(listTop);
      }
      if (!state.stop && count != null && done >= count) log(`Did ${done}. ${summary()}`);
    } catch (err) {
      console.error(err);
      log(`Error: ${err.message}. ${summary()}`);
    } finally {
      state.running = false; state.capturing = false; state.pending = null;
      updateButtons();
    }
  }

  function summary() {
    const of = state.expected ? ` of ${state.expected}` : '';
    const bad = state.failed.length ? `, ${state.failed.length} failed` : '';
    const parts = state.part ? ` (${state.part} zip part${state.part > 1 ? 's' : ''} saved)` : '';
    return `${state.ids.size}${of} collected${bad}${parts}.`;
  }

  // Save what's collected but not yet saved as the next zip part, then free it.
  async function saveZip() {
    if (!state.files.length) { log(`Nothing new to save. ${summary()}`); return; }
    const batch = state.files;
    state.files = [];
    const n = ++state.part;
    log(`Building zip part ${n} (${batch.length} files)…`);
    const zip = new JSZip();
    for (const f of batch) zip.file(f.name, f.text);
    if (state.failed.length) zip.file('failed.txt', state.failed.join('\n') + '\n');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const a = document.createElement('a');
    const url = origCreateObjectURL.call(URL, blob);
    a.href = url;
    a.download = `waterspeed-gpx-${new Date().toISOString().slice(0, 10)}-part${String(n).padStart(2, '0')}.zip`;
    document.body.appendChild(a);
    origAnchorClick.call(a);
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    log(`Saved zip part ${n} (${batch.length} files). ${summary()}`);
    updateButtons();
  }

  // --- Panel ----------------------------------------------------------------

  let ui = {};
  function log(msg) {
    console.log('[wsgpx]', msg);
    if (ui.status) ui.status.textContent = msg;
  }
  function updateButtons() {
    if (!ui.start) return;
    ui.start.disabled = state.running;
    ui.start.textContent = state.done.size && !state.running ? 'Resume' : 'Start';
    ui.stop.disabled = !state.running;
    ui.save.disabled = state.running || !state.files.length;
  }

  function buildPanel() {
    if (document.getElementById('wsgpx-panel')) return;
    const p = document.createElement('div');
    p.id = 'wsgpx-panel';
    p.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'background:#1f2427', 'color:#e8eaeb', 'border:1px solid #3a4146',
      'border-radius:10px', 'padding:10px 12px', 'font:13px system-ui,sans-serif',
      'box-shadow:0 4px 16px rgba(0,0,0,.4)', 'width:260px',
    ].join(';');
    p.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px">GPX export</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <label style="flex:1">Skip first<br><input id="wsgpx-skip" type="number" min="0" value="0" style="width:100%"></label>
        <label style="flex:1">How many<br><input id="wsgpx-count" type="number" min="1" placeholder="all" style="width:100%"></label>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button id="wsgpx-go">Start</button>
        <button id="wsgpx-stop">Stop</button>
        <button id="wsgpx-save">Save zip</button>
      </div>
      <div id="wsgpx-status" style="opacity:.85;min-height:1.2em">Set the list filter, then Start.</div>`;
    document.body.appendChild(p);
    p.querySelectorAll('input').forEach((el) => {
      el.style.cssText += ';background:#2b3236;color:inherit;border:1px solid #3a4146;border-radius:4px;padding:2px 4px';
    });
    ui = {
      start: p.querySelector('#wsgpx-go'),
      stop: p.querySelector('#wsgpx-stop'),
      save: p.querySelector('#wsgpx-save'),
      status: p.querySelector('#wsgpx-status'),
    };
    ui.start.onclick = () => {
      const skip = Math.max(0, parseInt(p.querySelector('#wsgpx-skip').value, 10) || 0);
      const n = parseInt(p.querySelector('#wsgpx-count').value, 10);
      run(skip, Number.isFinite(n) && n > 0 ? n : null);
    };
    ui.stop.onclick = () => { state.stop = true; log('Stopping after this activity…'); };
    ui.save.onclick = saveZip;
    updateButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildPanel);
  } else {
    buildPanel();
  }
})();
