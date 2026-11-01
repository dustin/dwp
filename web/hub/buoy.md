---
title: Buoys
sidebar: false
---

```js
// Old links to buoy.html with a time (?t=, ?c=) or #compare were for
// Pauwela's page; send those on to it.
{
  const q = new URLSearchParams(location.search);
  if (q.has("t") || q.has("c") || location.hash === "#compare")
    location.replace(`buoy/pauwela.html${location.search}${location.hash}`);
}
```

# Buoys

```js
import {BUOYS, renderBuoyMap} from "./components/buoy-map.js";
import {fetchBuoySnapshot} from "./components/data.js";
const snapshots = Object.fromEntries(await Promise.all(Object.keys(BUOYS).map(async site =>
  [site, await fetchBuoySnapshot(new Date(), site).catch(() => null)])));
```

<div class="card">${resize(width => renderBuoyMap({width, snapshots, href: site => `buoy/${site}.html`}))}</div>
