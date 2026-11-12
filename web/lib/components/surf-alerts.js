// Maui High Surf Advisories and Warnings from the National Weather
// Service, as bot/surf-alerts keeps them in live/alerts.json (polled every
// 10 minutes on aws1). Each alert has event, severity, headline, what,
// where, when, impacts, description, shores (["north", "east"], [] when
// unsaid), spots (maliko for north/east shores, kihei for south/west),
// sent, onset, ends and url.

import * as d3 from 'npm:d3';
import {html} from 'npm:htl';
import * as fmt from './formatters.js';

const DATAHOST = 'd2qwe1xndvncw9.cloudfront.net';

// The alerts that haven't ended, for `spot` (kihei or maliko) or all of
// them. [] when the file is missing or unreadable.
export async function fetchSurfAlerts(spot, now = new Date()) {
  try {
    const r = await fetch(`https://${DATAHOST}/live/alerts.json`, {cache: 'no-cache'});
    if (!r.ok) return [];
    const {alerts} = await r.json();
    return alerts
      .map(a => ({...a, ends: a.ends ? new Date(a.ends) : null, sent: a.sent ? new Date(a.sent) : null}))
      .filter(a => (!a.ends || a.ends > now) && (!spot || a.spots.includes(spot)));
  } catch {
    return [];
  }
}

const isWarning = a => /warning/i.test(a.event);
const shoreWords = a => a.shores.length
  ? (w => w[0].toUpperCase() + w.slice(1))(`${a.shores.join(" and ").replace(/ and (?=.* and )/g, ", ")} facing shores of Maui`)
  : "Maui shores";

export const BANNER_STYLE = html`<style>
  .surf-alert { --sa: #e8743b; max-width: 1100px; margin: 0.75rem 0 1rem; padding: 0.75rem 1rem;
    border-left: 6px solid var(--sa); border-radius: 6px; background: color-mix(in srgb, var(--sa) 14%, transparent); }
  .surf-alert.sa-warning { --sa: #d64545; }
  .surf-alert .sa-top { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; align-items: baseline; }
  .surf-alert .sa-event { font-size: 1.35rem; font-weight: 700; color: color-mix(in srgb, var(--sa) 75%, var(--theme-foreground)); }
  .surf-alert .sa-until { margin-left: auto; color: var(--theme-foreground-muted); }
  .surf-alert .sa-what { margin-top: 0.35rem; }
  .surf-alert details { margin-top: 0.35rem; color: var(--theme-foreground-muted); font-size: 0.9rem; }
  .surf-alert details pre { white-space: pre-wrap; font-family: inherit; margin: 0.35rem 0 0; }
  .surf-alert-line { --sa: #e8743b; display: table; font-weight: 600; padding: 0.3rem 0.75rem; margin: 0.25rem 0.5rem 0.5rem 0;
    border-left: 4px solid var(--sa); border-radius: 4px; background: color-mix(in srgb, var(--sa) 14%, transparent); }
  .surf-alert-line.sa-warning { --sa: #d64545; }
</style>`;

// A big banner per alert for the top of a spot page, or nothing.
export function surfAlertBanner(alerts) {
  if (!alerts.length) return document.createDocumentFragment();
  return html`${BANNER_STYLE}${alerts.map(a => html`<div class="surf-alert ${isWarning(a) ? "sa-warning" : ""}">
    <div class="sa-top">
      <span class="sa-event">⚠ ${a.event}</span>
      <span>${shoreWords(a)}</span>
      ${a.ends ? html`<span class="sa-until">until ${fmt.minuteStamp(a.ends)}</span>` : ""}
    </div>
    ${a.what ? html`<div class="sa-what">${a.what}</div>` : ""}
    <details><summary>Full NWS text${a.sent ? ` · issued ${fmt.minuteStamp(a.sent)}` : ""}</summary>
      <pre>${a.description ?? ""}</pre>
      <a href=${a.url} target="_blank" rel="noopener">NWS Honolulu</a>
    </details>
  </div>`)}`;
}

// One short line per alert for the hub, linking to the spot's page.
export function surfAlertLines(alerts) {
  if (!alerts.length) return document.createDocumentFragment();
  const page = a => a.spots.length === 1 ? (a.spots[0] === "kihei" ? "kihei.html" : "maliko.html") : null;
  return html`${BANNER_STYLE}<div>${alerts.map(a => {
    const text = `⚠ ${a.event}: ${shoreWords(a)}${a.ends ? ` until ${fmt.minuteStamp(a.ends)}` : ""}`;
    return html`<span class="surf-alert-line ${isWarning(a) ? "sa-warning" : ""}">${page(a) ? html`<a href=${page(a)}>${text}</a>` : text}</span>`;
  })}</div>`;
}

// Short words for the e-paper strip: "N + E shores", "until Sat 06:00".
export const shortShores = a => a.shores.length ? `${a.shores.map(s => s[0].toUpperCase()).join(" + ")} shores` : "Maui";
export const shortUntil = a => a.ends ? `until ${d3.timeFormat("%a %H:%M")(a.ends)}` : "";
