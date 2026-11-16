---
title: Import your runs
toc: false
---

# Import your runs

Getting your downwind runs onto downwind.pro takes two steps:

1. [Get your data](#1-get-your-data) out of the app you track with, Waterspeed
   or Strava.
2. [Send your data](#2-send-your-data) to Dustin, by upload or a shared Google
   Drive folder.

Watch recordings are best, since they
include heart rate. If you have both a watch and a phone recording of a run,
send both; the watch track is used. Also tell Dustin which board and foil you
ride, so your runs are labeled right.

## 1. Get your data

Use whichever app you record your runs with.

### From Waterspeed

Waterspeed only lets you download one GPX file at a time. This browser script
walks your Waterspeed activity list and downloads the GPX for every run,
bundled into zip files of 50.

It runs on a computer, not a phone. It works in Chrome, Firefox, Edge and other
desktop browsers that have the Violentmonkey extension.

#### Install Violentmonkey

Add [Violentmonkey](https://violentmonkey.github.io/get-it/) to your browser.
It's a free, open-source extension that runs small scripts on websites.

#### Install the script

```js
display(html`<p><a class="imp-button" href="/waterspeed-gpx-export.user.js">Install Waterspeed GPX bulk export</a></p>`);
```

Violentmonkey opens an install page for it. Click **Confirm installation**.
The script only runs on go.waterspeedapp.com, and Violentmonkey keeps it up to
date from this site.

#### Export your runs

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

If any runs failed, there's a `failed.txt` in the zip listing them.

### From Strava

#### Everything at once

Strava can send you an archive of your whole account, with every activity's
original file.

1. Sign in on the Strava website and open
   [Download or Delete Your Account](https://www.strava.com/athlete/delete_your_account)
   (Settings → My Account → Download or Delete Your Account → Get Started).
2. Under **Download Request**, press **Request Your Archive**. This only
   downloads your data; it doesn't delete anything.
3. Strava emails you a download link when the archive is ready. That can take a
   few hours.
4. Download the zip and send it as it is. Your downwinders are picked out of it,
   so there's no need to sort through it first.

#### A few runs

For a handful of runs, open each activity on the
[Strava website](https://www.strava.com/athlete/training), click the **⋯**
menu on the left and choose **Export Original** (or **Export GPX** if that's
all there is). The original file from your watch keeps heart rate and the most
detail.

## 2. Send your data

Either way works; pick one.

### Upload

Drop your zip or GPX files into
[copyparty.sallings.org/upload](https://copyparty.sallings.org/upload/).
That's all; nothing else to sign up for.

### Google Drive

If you'll keep riding and want new runs to show up without sending files each
time, put your GPX files in a Google Drive folder and share it with Google user
**dsallings** (view access is enough). Once Dustin has it set up, new files you add are imported
from there.

Names like `2026-10-13 Downwind Maliko Harbor watch Or685.gpx` help: date,
where you rode, watch or phone, and the foil.

<style>
  .imp-button { display: inline-block; padding: 0.5rem 1rem; border-radius: 6px;
    background: var(--theme-foreground-focus); color: var(--theme-background); font-weight: 600;
    text-decoration: none; }
  .imp-button:hover { text-decoration: none; opacity: 0.9; }
</style>
