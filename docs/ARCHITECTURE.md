# Architecture

A static React + TypeScript app built with Vite. Everything runs on the customer's device: no backend, no accounts.

## Paint engine (`src/engine`)

```
photo / camera frame
   │
   ├─ source canvas (≤2048 px) ──────────────► WebGL texture
   └─ analysis canvas (≤512 px, live ≤288 px)
         ├─ CIELAB + edge map (classicSegmenter)
         └─ AI segmenter (MediaPipe Magic Touch)
                     │
            per-wall mask (0–1) + brush edits
                     │
     renderer.ts: shader recolours masked pixels
```

- **Recolouring** happens in linear light. Each pixel's luminance relative to the wall's median luminance scales the paint colour, so shadows, highlights and texture stay. Finishes add a little sheen in bright areas.
- **Detection**: the AI model gives a soft mask from a tap. The edge detector grows a region in CIELAB space, stopping at strong edges, with lightness down-weighted so shading on one wall stays in. "Spread" controls its tolerance. If the model can't load, the app switches to edge detection automatically.
- **Edits**: each wall keeps its detector output plus brush add/erase layers. Undo snapshots share unchanged arrays, so history is cheap.
- **Live camera**: frames are analysed about 9 times a second, one wall per tick. A block-matching tracker on an 80×60 thumbnail moves tap points with the camera pan, and points drift toward the middle of their wall so they don't slip off edges. Masks are smoothed over time.
- **Up to 8 walls** are packed into two RGBA mask textures.

## App (`src/app`, `src/features`)

`StoreProvider` holds the catalogue, the active `PaintSession`, favourites, calculator rooms and order quantities. Components read the engine state through `useSyncExternalStore`.

Layout: on screens 1024 px and wider the stage and a tabbed panel sit side by side; on phones a bottom tab bar switches between Paint, Colours, Quantity, Buy and Saved. The WebGL canvas stays mounted throughout.

## Data

`public/data/*.json`, loaded at start-up. `?preview=1` loads the catalogue manager's unsaved draft from local storage instead. `validateCatalogue` guards both the app tests and the manager's publish step.

## Offline and install

`public/sw.js` caches the app shell, built assets, the WASM runtime and the AI model after first use, so the app opens and paints without a connection. `manifest.webmanifest` makes it installable.

## Privacy

Photos never leave the device. Saved projects live in the browser's IndexedDB. Analytics, if turned on, send only event names, colour codes and counts.

## Testing

- `npm test`: colour maths (including CIEDE2000 reference values), calculator, CSV, geo, WhatsApp order text, in-app browser detection, edge detector, tracker, and validation of the shipped data.
- `npm run e2e`: real Chromium: painting, undo, colour match, scenes, upload, calculator, projects, WhatsApp order, admin, phone layout, live camera fed from a fake video device, and the refused-permission message.
