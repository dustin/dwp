---
title: Import your runs
toc: false
---

# Import your runs

<p class="imp-lede">Two steps: get your runs out of the app you track with, then send them to downwind.pro.</p>

<div class="imp-steps">
  <a href="#get"><span class="imp-num">1</span><span><b>Get your data out</b><small>From Waterspeed or Strava</small></span></a>
  <a href="#send"><span class="imp-num">2</span><span><b>Send it to downwind.pro</b><small>Upload, or share a Drive folder</small></span></a>
</div>

<div class="imp-tip"><span>💡</span><div>Watch recordings are best, since they include heart rate. Have a watch and a phone recording of the same run? Send both; the watch track is used. And tell Dustin which board and foil you ride, so your runs are labeled right.</div></div>

<section class="imp-card imp-get" id="get">
<h2 class="imp-h"><span class="imp-num">1</span> Get your data out</h2>
<p class="imp-sub">Which app do you record your runs with?</p>
<div class="imp-tabs" role="radiogroup" aria-label="Your app">
  <label class="imp-tab imp-tab-ws"><input type="radio" name="imp-app" value="waterspeed" checked><span class="imp-dot"></span>Waterspeed</label>
  <label class="imp-tab imp-tab-st"><input type="radio" name="imp-app" value="strava"><span class="imp-dot"></span>Strava</label>
</div>

<div class="imp-panel imp-ws">
<div class="imp-badges"><span>💻 Computer only</span><span>⏱ About 5 minutes to set up</span><span>A few seconds per run</span></div>
<p>Waterspeed only lets you download one run at a time, so this browser script does it for you: it goes through your activity list and saves every run, in zip files of 50.</p>
<ol class="imp-do">
<li><b>Add Violentmonkey to your browser</b>A free extension that runs small scripts on websites. It works in Chrome, Firefox, Edge and other desktop browsers. <a href="https://violentmonkey.github.io/get-it/">Get Violentmonkey</a></li>
<li><b>Install the export script</b>Violentmonkey opens an install page. Click <strong>Confirm installation</strong>. The script only runs on Waterspeed's site and keeps itself up to date.

```js
display(html`<a class="imp-btn" href="/waterspeed-gpx-export.user.js">Install Waterspeed GPX bulk export</a>`);
```

</li>
<li><b>Run the export</b>Sign in at <a href="https://go.waterspeedapp.com/">go.waterspeedapp.com</a>, go to <strong>Activities</strong> and set the filter to what you want, for example <em>Downwind</em> and <em>All time</em>. Then press <strong>Start</strong> in the <strong>GPX export</strong> panel in the bottom-right corner. Leave <strong>How many</strong> empty to export everything.</li>
<li><b>Save the zips</b>Your browser asks you to save a zip after every 50 runs. When it reaches the end of the list, press <strong>Save zip</strong> for the last one. A few hundred runs take a while; you can leave it going in its own window.</li>
</ol>
<details>
<summary>If it stops or something goes wrong</summary>
<ul>
<li>Don't reload the Waterspeed page while it's running: runs not yet saved in a zip are lost.</li>
<li>If you stop it, <strong>Save zip</strong> saves what it has so far, and <strong>Resume</strong> carries on from where it stopped.</li>
<li>To pick up later after a reload, put the number of runs already saved in <strong>Skip first</strong>.</li>
<li>If any runs failed, there's a <code>failed.txt</code> in the zip listing them.</li>
</ul>
</details>
</div>

<div class="imp-panel imp-st">
<h3>Everything at once</h3>
<div class="imp-badges"><span>💻 Strava website</span><span>⏱ The archive can take a few hours</span></div>
<ol class="imp-do">
<li><b>Open the account download page</b>Sign in on the Strava website and open <a href="https://www.strava.com/athlete/delete_your_account">Download or Delete Your Account</a> (Settings → My Account → Download or Delete Your Account → Get Started).</li>
<li><b>Request your archive</b>Under <strong>Download Request</strong>, press <strong>Request Your Archive</strong>. This only downloads your data; it doesn't delete anything.</li>
<li><b>Download the zip from Strava's email</b>Send it as it is. Your downwinders are picked out of it, so there's no need to sort through it first.</li>
</ol>
<h3>Just a few runs</h3>
<p>Open each activity on the <a href="https://www.strava.com/athlete/training">Strava website</a>, click the <strong>⋯</strong> menu on the left and choose <strong>Export Original</strong> (or <strong>Export GPX</strong> if that's all there is). The original file from your watch keeps heart rate and the most detail.</p>
</div>
</section>

<section class="imp-card" id="send">
<h2 class="imp-h"><span class="imp-num">2</span> Send it to downwind.pro</h2>
<p class="imp-sub">Pick one.</p>
<div class="imp-opts">
  <div class="imp-opt">
    <h3>⬆️ Upload</h3>
    <div class="imp-when">Best for a one-time import</div>
    <p>Drop your zip or GPX files on the upload page. Nothing to sign up for.</p>
    <a class="imp-btn" href="https://copyparty.sallings.org/upload/">Open upload page</a>
  </div>
  <div class="imp-opt">
    <h3>📁 Google Drive folder</h3>
    <div class="imp-when">Best if you'll keep riding</div>
    <p>Put your GPX files in a Google Drive folder and share it with Google user <strong>dsallings</strong> (view access is enough). Once Dustin has it set up, new runs you add there show up on their own.</p>
  </div>
</div>
<details>
<summary>File naming tips</summary>
<p>Names like <code>2026-10-13 Downwind Maliko Harbor watch Or685.gpx</code> help: the date, where you rode, watch or phone, and the foil.</p>
</details>
<details>
<summary>In the downwind.pro Matrix room? The bot can import too</summary>
<p>Send your files to the <a href="./bot">bot</a> and it imports them.</p>
</details>
</section>

```js
// Remember which app the rider picked.
{
  const KEY = "import-app";
  const radios = [...document.querySelectorAll('input[name="imp-app"]')];
  try {
    const saved = localStorage.getItem(KEY);
    const r = radios.find((r) => r.value === saved);
    if (r) r.checked = true;
  } catch {}
  for (const r of radios) r.addEventListener("change", () => { try { localStorage.setItem(KEY, r.value); } catch {} });
}
```

<style>
  .imp-lede { color: var(--theme-foreground-muted); margin-top: -0.5rem; max-width: none; }
  .imp-num { flex: none; display: inline-grid; place-items: center; width: 1.8rem; height: 1.8rem; border-radius: 50%;
    background: var(--theme-foreground-focus); color: var(--theme-background); font-weight: 700; font-size: 0.95rem; }
  .imp-steps { display: flex; gap: 0.6rem; flex-wrap: wrap; margin: 1.2rem 0; }
  .imp-steps a { flex: 1 1 14rem; display: flex; gap: 0.7rem; align-items: center; padding: 0.7rem 0.9rem;
    border: 1px solid var(--theme-foreground-faintest); border-radius: 10px; background: var(--theme-background-alt);
    color: inherit; text-decoration: none; }
  .imp-steps a:hover { border-color: var(--theme-foreground-focus); }
  .imp-steps b, .imp-steps small { display: block; }
  .imp-steps small { color: var(--theme-foreground-muted); font-size: 0.85rem; }
  .imp-tip { display: flex; gap: 0.7rem; padding: 0.7rem 0.9rem; margin: 1.2rem 0; border-radius: 10px;
    background: color-mix(in srgb, #f5c518 14%, var(--theme-background));
    border: 1px solid color-mix(in srgb, #f5c518 45%, var(--theme-background)); }
  .imp-card { border: 1px solid var(--theme-foreground-faintest); border-radius: 12px; padding: 1rem 1.1rem 0.4rem;
    margin: 1.4rem 0; scroll-margin-top: 1rem; }
  .imp-card p, .imp-card li, .imp-card ol, .imp-card ul { max-width: none; }
  .imp-h { display: flex; gap: 0.6rem; align-items: center; margin: 0; }
  .imp-sub { color: var(--theme-foreground-muted); margin: 0.2rem 0 0.9rem; }
  .imp-tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  .imp-tab { flex: 1; display: flex; gap: 0.5rem; align-items: center; justify-content: center; padding: 0.6rem;
    border: 2px solid var(--theme-foreground-faintest); border-radius: 10px; font-weight: 600; cursor: pointer; }
  .imp-tab input { position: absolute; opacity: 0; pointer-events: none; }
  .imp-tab:has(input:focus-visible) { outline: 2px solid var(--theme-foreground-focus); outline-offset: 2px; }
  .imp-dot { width: 0.75rem; height: 0.75rem; border-radius: 3px; background: var(--app); }
  .imp-tab-ws, .imp-ws { --app: #0a8f8f; }
  .imp-tab-st, .imp-st { --app: #fc5200; }
  .imp-tab:has(input:checked) { border-color: var(--app); background: color-mix(in srgb, var(--app) 10%, var(--theme-background)); }
  .imp-get:has(input[value="waterspeed"]:checked) .imp-st,
  .imp-get:has(input[value="strava"]:checked) .imp-ws { display: none; }
  .imp-panel { border-left: 4px solid var(--app); padding: 0 0 0 0.9rem; margin-bottom: 0.8rem; }
  .imp-panel h3 { margin: 0.6rem 0 0.4rem; }
  .imp-badges { display: flex; gap: 0.4rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
  .imp-badges span { font-size: 0.8rem; padding: 0.1rem 0.55rem; border-radius: 999px; color: var(--theme-foreground-muted);
    background: var(--theme-background-alt); border: 1px solid var(--theme-foreground-faintest); }
  .imp-do { list-style: none; padding: 0; counter-reset: imp; }
  .imp-do > li { counter-increment: imp; position: relative; padding: 0 0 0.9rem 2.4rem; margin: 0; }
  .imp-do > li::before { content: counter(imp); position: absolute; left: 0; top: 0; width: 1.6rem; height: 1.6rem;
    border-radius: 50%; border: 2px solid var(--app); color: var(--app); display: grid; place-items: center;
    font-weight: 700; font-size: 0.85rem; box-sizing: border-box; }
  .imp-do > li > b { display: block; }
  .imp-btn { display: inline-block; margin-top: 0.4rem; padding: 0.45rem 0.9rem; border-radius: 6px;
    background: var(--theme-foreground-focus); color: var(--theme-background) !important; font-weight: 600; text-decoration: none; }
  .imp-btn:hover { text-decoration: none; opacity: 0.9; }
  .imp-card details { border-top: 1px solid var(--theme-foreground-faintest); padding: 0.6rem 0; }
  .imp-card summary { cursor: pointer; font-weight: 600; }
  .imp-opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 0.8rem; margin-bottom: 0.9rem; }
  .imp-opt { padding: 0.8rem 0.9rem; border-radius: 10px; background: var(--theme-background-alt);
    border: 1px solid var(--theme-foreground-faintest); }
  .imp-opt h3 { margin: 0; }
  .imp-opt p { margin: 0.3rem 0; }
  .imp-when { font-size: 0.85rem; font-weight: 600; color: var(--theme-foreground-focus); }
</style>
