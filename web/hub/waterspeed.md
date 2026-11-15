---
title: Export your Waterspeed runs
toc: false
---

# Export your Waterspeed runs

Waterspeed only lets you download one GPX file at a time. This browser script
walks your Waterspeed activity list and downloads the GPX for every run,
bundled into zip files of 50, so your runs can be imported here.

It runs on a computer, not a phone. It works in Chrome, Firefox, Edge and other
desktop browsers that have the Violentmonkey extension.

## 1. Install Violentmonkey

Add [Violentmonkey](https://violentmonkey.github.io/get-it/) to your browser.
It's a free, open-source extension that runs small scripts on websites.

## 2. Install the script

```js
display(html`<p><a class="ws-install" href="/waterspeed-gpx-export.user.js">Install Waterspeed GPX bulk export</a></p>`);
```

Violentmonkey opens an install page for it. Click **Confirm installation**.
The script only runs on go.waterspeedapp.com, and Violentmonkey keeps it up to
date from this site.

## 3. Export your runs

1. Open [go.waterspeedapp.com](https://go.waterspeedapp.com/) and sign in.
2. Go to **Activities** and set the filter to what you want exported, for
   example **Downwind** and **All time**.
3. Use the **GPX export** panel in the bottom-right corner and press **Start**.
   Leave **How many** empty to export everything.
4. Your browser asks you to save a zip file after every 50 runs. When it reaches
   the end of the list, press **Save zip** to save the last one.

It opens each run in turn, so it takes a few seconds per run. A few hundred runs
take a while; you can leave it going in its own window.

Don't reload the Waterspeed page while it's running: runs not yet saved in a
zip are lost. If you stop it, **Save zip** saves what it has so far, and
**Resume** carries on from where it stopped. To pick up later after a reload,
put the number of runs already saved in **Skip first**.

## 4. Send the zips

Drop the zip files into [copyparty.sallings.org/upload](https://copyparty.sallings.org/upload/).
If any runs failed, there's a `failed.txt` in the zip listing them.

<style>
  .ws-install { display: inline-block; padding: 0.5rem 1rem; border-radius: 6px;
    background: var(--theme-foreground-focus); color: var(--theme-background); font-weight: 600;
    text-decoration: none; }
  .ws-install:hover { text-decoration: none; opacity: 0.9; }
</style>
