---
title: lowbattery
toc: false
sidebar: false
header: false
footer: false
pager: false
---

<style>
  /* Fills whatever panel it's rendered at (db/display renders it once per
     device size); text scales with the panel. */
  html, body { margin: 0; padding: 0; background: #fff; overflow: hidden; }
  #observablehq-main { margin: 0; padding: 0; min-height: 0; max-width: none; }
  #observablehq-center { margin: 0; padding: 0; }
  #observablehq-main > .observablehq { margin: 0; }
  .lb { width: 100vw; height: 100vh; box-sizing: border-box; padding: 5vh 6vw; color: #000; background: #fff;
    font-family: "DejaVu Sans", "Liberation Sans", Arial, Helvetica, sans-serif; -webkit-font-smoothing: none;
    display: flex; flex-direction: column; justify-content: center; gap: 4vh; border: max(3px, 1vh) solid #000; }
  .lb-head { display: flex; align-items: center; gap: 4vw; }
  .lb svg { height: 22vh; flex: none; }
  .lb h1 { margin: 0; font-size: min(14vh, 9vw); font-weight: 800; line-height: 1; max-width: none; color: #000; }
  .lb p { margin: 0; font-size: min(7.5vh, 4.6vw); font-weight: 700; line-height: 1.25; max-width: none; }
</style>

```js
// Shown by the display server (db/display/server.py) instead of a device's
// page while its battery is low. The device then sleeps for hours, so this
// stays on the panel until it's charged.
display(html`<div class="lb">
  <div class="lb-head">
    <svg viewBox="0 0 64 32" aria-hidden="true">
      <rect x="2" y="2" width="54" height="28" rx="4" fill="#fff" stroke="#000" stroke-width="4"/>
      <rect x="57" y="10" width="5" height="12" rx="1" fill="#000"/>
      <rect x="7" y="7" width="8" height="18" fill="#000"/>
    </svg>
    <h1>Battery low</h1>
  </div>
  <p>No new images until it's charged. Plug it in and it'll pick up again on its next check.</p>
</div>`);
document.documentElement.dataset.ready = "";
```
