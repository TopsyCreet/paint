# Catalogue data

The app reads four JSON files from `public/data/`. The catalogue manager (`admin.html`) edits and exports all of them; this page documents the format for anyone editing by hand.

## brand.json

| Field | Meaning |
| --- | --- |
| `name`, `shortName`, `tagline` | Shown in the header, page title and shared images. |
| `sampleDataNotice` | Shows a "Sample catalogue" chip. Delete or leave empty for real data. |
| `madeBy` | Credit line in the footer. |
| `colours.primary`, `colours.primaryInk` | Brand colour (buttons, highlights) and the text colour on it. Hex. |
| `currency`, `locale` | Price formatting, e.g. `NGN`, `en-NG`. |
| `whatsappFallback` | Number for orders when a distributor has none. Digits only, international: `2348012345678`. Empty lets the customer choose a chat. |
| `disclaimer` | Colour accuracy note under the preview. |
| `segmentation.enabled` | `false` turns off the AI model and always uses edge detection. |
| `segmentation.modelUrl` | MediaPipe interactive segmenter model. Default is Google's hosted `magic_touch.tflite`. To self-host, download it into `public/models/` and set `"models/magic_touch.tflite"`. |
| `segmentation.wasmBase` | Folder of the MediaPipe WASM runtime. `vendor/mediapipe/wasm` is filled automatically by `npm install`. |
| `analytics.provider`, `analytics.id` | `none`, `ga4` (id `G-XXXX`) or `plausible` (id = your domain). |

## shades.json

```json
{
  "families": [{ "id": "white", "label": "Whites & creams" }],
  "shades": [
    { "id": "agbada-white", "name": "Agbada White", "code": "CS-101", "hex": "#EFEBE3", "family": "white" }
  ]
}
```

Optional per shade: `collection`, `lrv` (manufacturer's light reflectance value; otherwise computed), `products` (ids of products it can be tinted in; otherwise all).

Use the manufacturer's measured colour values where possible. Screen colours from brochures are often off.

## products.json

```json
[{ "id": "matt", "name": "Interior Matt Emulsion", "finish": "matt", "use": "interior", "coverage": 12,
   "sizes": [{ "litres": 4, "price": 24500 }, { "litres": 20, "price": 108000 }] }]
```

`finish`: `matt`, `satin`, `silk` or `gloss`. `use`: `interior`, `exterior` or `both`. `coverage`: m² per litre per coat (from the tin or data sheet). Prices are in the brand currency.

## distributors.json

```json
[{ "id": "allen-avenue", "name": "Allen Avenue Paint Centre", "address": "24 Allen Avenue", "city": "Ikeja", "state": "Lagos",
   "lat": 6.6065, "lng": 3.3536, "phone": "+234 801 234 5678", "whatsapp": "2348012345678", "hours": "Mon–Sat, 8am–6pm" }]
```

Get coordinates by right-clicking the shop in Google Maps and copying the numbers. `sample: true` labels a placeholder record.

## CSV import

Shades: `name, code, hex, family` (optional `id, collection, lrv`).
Distributors: `name, address, city, state, lat, lng, phone, whatsapp, hours`.

Headers are case-insensitive. Rows without a name or valid colour/coordinates are skipped and reported.

## Sample rooms

The three sample scenes are drawn in code (`src/engine/sampleRooms.ts`) so the app needs no stock photos. Their preset walls use the shade ids `okra-green`, `lavender-gele` and `lekki-sand`; if those ids are missing from a brand's catalogue the scenes load unpainted.
