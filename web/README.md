# Web

Two [Observable Framework](https://observablehq.com/framework/) sites built from one package:

- **rider** (`rider/`, `rider.config.js`): the per-rider dashboard, served for every `<rider>.downwind.pro`. The rider comes from the hostname (`lib/components/data.js`); add `?rider=walter` to view another rider's data anywhere, including locally.
- **hub** (`hub/`, `hub.config.js`): `downwind.pro` itself, with the landing page (conditions and riders), tides and the MagTag cards.

Shared code lives in `lib/`: `lib/components/` and `lib/data/islands.json` are symlinked into each site as `components/` and `data/islands.json`, so pages import `./components/…` as usual.

Run data comes from the CDN under `runs/rider=<rider>/` (see `db/upload-runs.sh`). `rider/data/` holds a bundled copy of Dustin's lists for when the CDN can't be reached.

## Setup

```
npm install
```

The map pages import `../token.js` for the Mapbox token. CI writes it; locally, create `rider/token.js` and `hub/token.js` (both gitignored):

```js
export const MAPBOX_TOKEN = '';
```

## Commands

| Command             | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `npm run dev:rider` | Preview the rider site at <http://localhost:3001>        |
| `npm run dev:hub`   | Preview the hub at <http://localhost:3002>               |
| `npm run dev`       | Same as `dev:rider`                                      |
| `npm run build`     | Build both sites into `dist/rider` and `dist/hub`        |
| `npm run build:rider` / `npm run build:hub` | Build one site                   |
| `npm run clean`     | Clear both sites' data loader caches                     |

Pushing to `main` builds both and deploys `dist/hub` to `/var/www/dwp/` and `dist/rider` to `/var/www/dwp-rider/` (`.github/workflows/node.js.yml`).

## Tests

`tests/dashboard-test.js` loads the rider site and follows its links (`BASE_URL`, default `http://localhost:3000`). `runtest.sh` builds, serves `dist/rider` with nginx and runs it. `tests/run-backend-availability-test.js` checks that every run in `rider/data/runs.csv` has a track on the CDN.
