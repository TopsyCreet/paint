# Colour Studio

A paint colour visualizer for Nigerian paint brands. Customers paint the walls in a photo or through their phone camera, see the colour with real light and shadow, work out how much paint they need, and send the order to the nearest distributor on WhatsApp.

It runs in any modern phone or desktop browser and installs like an app (PWA). No app store, no server.

Built by Veil Technologies.

## What it does

| Area | Features |
| --- | --- |
| Paint | Sample rooms (living room, bedroom, house front), upload a photo, take a photo, or paint live through the camera. Up to 8 walls, each with its own colour and finish (matt, satin, silk, gloss). |
| Wall detection | **Smart**: Google MediaPipe "Magic Touch" AI model, runs on the phone. **Edge**: built-in colour and edge detection that works offline. Brush and eraser to fix edges. Undo and redo. |
| Live camera | Rear camera with a centre cross-hair, motion tracking so paint stays on the wall as you pan, and Capture to freeze a frame for editing. Plain-language help when the camera is blocked (permission, WhatsApp/Instagram browsers, http links). |
| Colours | Catalogue with search, families, saved favourites, LRV, suggested pairings, and colour matching from any point in a photo (CIEDE2000). |
| Quantity | Multi-room calculator: walls, doors, windows, ceilings and coats, with the cheapest mix of tin sizes and a price estimate. |
| Buy | Order lines from the painted colours, nearest distributors from your location or area, map, directions, call, and a ready-made WhatsApp order. |
| Saved | Projects (photo and painted walls) saved on the device. Share or download the painted image. |
| Catalogue manager | `admin.html`: edit brand, shades, products and distributors, import CSV, check for mistakes, preview, and download the data files. |

## Quick start

```bash
npm install        # also copies the MediaPipe WASM runtime into public/vendor
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # production build in dist/
npm run e2e        # browser tests incl. fake camera (needs Playwright + ffmpeg)
```

Node 20 or newer.

## Deploying to GitHub Pages

1. Push this repository to GitHub.
2. In the repository, open **Settings → Pages**: **Source** = Deploy from a branch, **Branch** = `gh-pages`, folder `/ (root)`.
3. Every push to `main` runs type checks, tests and the build, then publishes `dist/` to the `gh-pages` branch (for this repo: `https://<user>.github.io/paint/`).

Do not point Pages at `main`: that branch holds source code, which browsers can't run directly (you'd see a blank page).

The build uses relative paths, so it also works on a custom domain or any static host (Netlify, Vercel, Cloudflare Pages, cPanel).

**The camera only works over HTTPS** (GitHub Pages is HTTPS) and in a real browser. Links opened inside WhatsApp, Instagram or Facebook use their built-in browser, which blocks the camera; the app detects this and tells people to open the link in Chrome or Safari.

## Putting in a real paint brand's data

All brand content lives in `public/data/`. Edit it with the catalogue manager (`/admin.html`) or by hand. See [docs/DATA.md](docs/DATA.md).

1. Open `https://<your-site>/admin.html`.
2. Import the brand's colour list as CSV (name, code, hex, family), then their distributors (name, address, city, state, lat, lng, phone, whatsapp).
3. Fill in products, tin sizes and prices, and the brand details. Clear the sample-data notice.
4. Use **Preview in app** to check it, then **Download data files** and replace the four files in `public/data/`. Commit, and the site redeploys.

## Project structure

```
src/
  engine/      paint engine: WebGL renderer, AI + edge wall detection, live tracking, sample rooms, colour maths
  features/    screens: visualizer, colours, calculator, order, projects
  lib/         calculator, geo, WhatsApp order, CSV, camera, analytics, storage
  data/        data types, loader and validation
  admin/       catalogue manager
public/
  data/        brand.json, shades.json, products.json, distributors.json
  sw.js        offline support
tests/         unit tests (Vitest)
e2e/           browser tests (Playwright)
docs/          architecture, data format
```

More detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Licences

Code: proprietary, © Veil Technologies Ltd. Third-party: React (MIT), three.js (MIT), Leaflet (BSD-2), MediaPipe Tasks (Apache-2.0), map data © OpenStreetMap contributors.
