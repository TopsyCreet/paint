import { SRGB_TO_LINEAR } from "./colour";

/**
 * Edge-aware region growing in CIELAB space. Works offline with no model, and is
 * the fallback when the AI segmenter cannot load. Operates on RGBA pixel data so
 * it can run in tests, workers and the main thread alike.
 */
export interface Frame {
  width: number;
  height: number;
  /** Lightness, a*, b* per pixel. */
  L: Float32Array;
  A: Float32Array;
  B: Float32Array;
  /** Linear luminance per pixel (0–1). */
  Y: Float32Array;
  /** Sobel gradient magnitude of L. */
  edge: Float32Array;
  /** Line-integrated edge strength, computed on demand (see lineEdges). */
  line?: Float32Array | null;
}

const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function analyseFrame(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, reuse?: Frame): Frame {
  const n = width * height;
  const f: Frame =
    reuse && reuse.width === width && reuse.height === height
      ? reuse
      : { width, height, L: new Float32Array(n), A: new Float32Array(n), B: new Float32Array(n), Y: new Float32Array(n), edge: new Float32Array(n) };
  const { L, A, B, Y, edge } = f;
  f.line = null;
  for (let i = 0; i < n; i++) {
    const r = SRGB_TO_LINEAR[rgba[i * 4]], g = SRGB_TO_LINEAR[rgba[i * 4 + 1]], b = SRGB_TO_LINEAR[rgba[i * 4 + 2]];
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const fx = labF(x), fy = labF(y), fz = labF(z);
    Y[i] = y;
    L[i] = 116 * fy - 16;
    A[i] = 500 * (fx - fy);
    B[i] = 200 * (fy - fz);
  }
  edge.fill(0);
  for (let yy = 1; yy < height - 1; yy++) {
    for (let xx = 1; xx < width - 1; xx++) {
      const i = yy * width + xx;
      const gx = -L[i - width - 1] - 2 * L[i - 1] - L[i + width - 1] + L[i - width + 1] + 2 * L[i + 1] + L[i + width + 1];
      const gy = -L[i - width - 1] - 2 * L[i - width] - L[i - width + 1] + L[i + width - 1] + 2 * L[i + width] + L[i + width + 1];
      edge[i] = (Math.abs(gx) + Math.abs(gy)) / 8;
    }
  }
  return f;
}

/**
 * Grows a region from each seed (normalised 0–1 coordinates). `spread` 0–100
 * controls how far colour and lighting may drift from the seed before stopping.
 */
export function growRegion(frame: Frame, seeds: Array<[number, number]>, spread: number): Uint8Array {
  const { width: w, height: h, L, A, B, edge } = frame;
  const out = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const seen = new Uint8Array(w * h);
  const globalT = 5 + spread * 0.32;
  const localT = 1.4 + spread * 0.05;
  const edgeT = 2.6 + spread * 0.09;
  for (const [nx, ny] of seeds) {
    const sx = Math.min(w - 1, Math.max(0, Math.floor(nx * w)));
    const sy = Math.min(h - 1, Math.max(0, Math.floor(ny * h)));
    const s = sy * w + sx;
    if (seen[s]) continue;
    const sL = L[s], sA = A[s], sB = B[s];
    let sp = 0;
    stack[sp++] = s;
    seen[s] = 1;
    out[s] = 1;
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p - x) / w;
      for (let k = 0; k < 4; k++) {
        let q: number;
        if (k === 0) { if (x === 0) continue; q = p - 1; }
        else if (k === 1) { if (x === w - 1) continue; q = p + 1; }
        else if (k === 2) { if (y === 0) continue; q = p - w; }
        else { if (y === h - 1) continue; q = p + w; }
        if (seen[q]) continue;
        const dl = L[p] - L[q], da = A[p] - A[q], db = B[p] - B[q];
        if (dl * dl + da * da + db * db > localT * localT || edge[q] > edgeT) continue;
        // Lightness is down-weighted so shading across one wall stays inside the region.
        const gl = 0.3 * (L[q] - sL), ga = A[q] - sA, gb = B[q] - sB;
        if (gl * gl + ga * ga + gb * gb > globalT * globalT) continue;
        seen[q] = 1;
        out[q] = 1;
        stack[sp++] = q;
      }
    }
  }
  return out;
}

export function dilate(m: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && m[yy * w + xx]) { v = 1; break; }
        }
      }
      o[y * w + x] = v;
    }
  }
  return o;
}

export function erode(m: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1;
      for (let dy = -1; dy <= 1 && v; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (!m[yy * w + xx]) { v = 0; break; }
        }
      }
      o[y * w + x] = v;
    }
  }
  return o;
}

/** Fills enclosed gaps smaller than `maxFraction` of the image (texture specks, switches). */
export function fillSmallHoles(m: Uint8Array, w: number, h: number, maxFraction = 0.008): void {
  const n = w * h;
  const label = new Uint8Array(n);
  const stack = new Int32Array(n);
  const limit = n * maxFraction;
  const comp: number[] = [];
  for (let i = 0; i < n; i++) {
    if (m[i] || label[i]) continue;
    let sp = 0, border = false;
    comp.length = 0;
    stack[sp++] = i;
    label[i] = 1;
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p - x) / w;
      comp.push(p);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && !m[p - 1] && !label[p - 1]) { label[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && !m[p + 1] && !label[p + 1]) { label[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && !m[p - w] && !label[p - w]) { label[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && !m[p + w] && !label[p + w]) { label[p + w] = 1; stack[sp++] = p + w; }
    }
    if (!border && comp.length < limit) for (const p of comp) m[p] = 1;
  }
}

/**
 * Keeps only connected regions that contain a seed (or the region nearest to a
 * seed within `searchRadius` pixels). Removes floating specks the AI model
 * sometimes adds elsewhere in the frame.
 */
export function keepSeedRegions(m: Uint8Array, w: number, h: number, seeds: Array<[number, number]>, searchRadius = 6): Uint8Array {
  const out = new Uint8Array(m.length);
  const stack = new Int32Array(m.length);
  for (const [nx, ny] of seeds) {
    let sx = Math.min(w - 1, Math.max(0, Math.floor(nx * w)));
    let sy = Math.min(h - 1, Math.max(0, Math.floor(ny * h)));
    if (!m[sy * w + sx]) {
      let found = false;
      for (let r = 1; r <= searchRadius && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r; dx++) {
          const x = sx + dx, y = sy + dy;
          if (x >= 0 && y >= 0 && x < w && y < h && m[y * w + x]) { sx = x; sy = y; found = true; break; }
        }
      }
      if (!found) continue;
    }
    const s = sy * w + sx;
    if (out[s]) continue;
    let sp = 0;
    stack[sp++] = s;
    out[s] = 1;
    while (sp) {
      const p = stack[--sp];
      const x = p % w, y = (p - x) / w;
      if (x > 0 && m[p - 1] && !out[p - 1]) { out[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && m[p + 1] && !out[p + 1]) { out[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && m[p - w] && !out[p - w]) { out[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && m[p + w] && !out[p + w]) { out[p + w] = 1; stack[sp++] = p + w; }
    }
  }
  return out;
}

/** Thresholds a soft mask, closes small gaps, fills holes and keeps the seeded regions. */
export function cleanMask(soft: Float32Array, w: number, h: number, seeds: Array<[number, number]>, threshold = 0.5): Float32Array {
  let m: Uint8Array = new Uint8Array(soft.length);
  for (let i = 0; i < soft.length; i++) m[i] = soft[i] > threshold ? 1 : 0;
  m = erode(dilate(m, w, h), w, h);
  fillSmallHoles(m, w, h, 0.02);
  m = keepSeedRegions(m, w, h, seeds);
  const f = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) f[i] = m[i];
  return f;
}

const LINE_ANGLES = 8, LINE_LEN = 4;
/** Tuned on a noisy, compressed hand-held clip: no wall/ceiling leaks at any Spread. */
const LINE_WEIGHT = 1.3;

/**
 * Edge strength averaged along straight lines in 8 directions. Where two walls
 * (or a wall and the ceiling) meet, the brightness step is often smaller than
 * camera noise at any single pixel, but it runs along a straight line, so
 * averaging along the line recovers it. Runs at half resolution (which also
 * averages noise) and is cached on the frame.
 */
export function lineEdges(frame: Frame): Float32Array {
  if (frame.line && frame.line.length === frame.L.length) return frame.line;
  const { width: W, height: H, L: Lf } = frame;
  const w = W >> 1, h = H >> 1;
  const L = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 2 * y * W + 2 * x;
    L[y * w + x] = (Lf[i] + Lf[i + 1] + Lf[i + W] + Lf[i + W + 1]) / 4;
  }
  const half = new Float32Array(w * h);
  const taps = 2 * LINE_LEN + 1;
  const offA = new Int32Array(taps), offB = new Int32Array(taps), dxs = new Int32Array(taps * 2), dys = new Int32Array(taps * 2);
  for (let a = 0; a < LINE_ANGLES; a++) {
    const th = (a * Math.PI) / LINE_ANGLES, tx = Math.cos(th), ty = Math.sin(th), nx = -ty, ny = tx;
    let maxX = 0, maxY = 0;
    for (let t = -LINE_LEN, k = 0; t <= LINE_LEN; t++, k++) {
      const ax = Math.round(tx * t + nx), ay = Math.round(ty * t + ny);
      const bx = Math.round(tx * t - nx), by = Math.round(ty * t - ny);
      offA[k] = ay * w + ax; offB[k] = by * w + bx;
      dxs[2 * k] = ax; dxs[2 * k + 1] = bx; dys[2 * k] = ay; dys[2 * k + 1] = by;
      maxX = Math.max(maxX, Math.abs(ax), Math.abs(bx)); maxY = Math.max(maxY, Math.abs(ay), Math.abs(by));
    }
    for (let y = 0; y < h; y++) {
      const inY = y >= maxY && y < h - maxY;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let s = 0, c = 0;
        if (inY && x >= maxX && x < w - maxX) {
          for (let k = 0; k < taps; k++) s += L[i + offA[k]] - L[i + offB[k]];
          c = taps;
        } else {
          for (let k = 0; k < taps; k++) {
            const ax = x + dxs[2 * k], ay = y + dys[2 * k], bx = x + dxs[2 * k + 1], by = y + dys[2 * k + 1];
            if (ax < 0 || ay < 0 || bx < 0 || by < 0 || ax >= w || bx >= w || ay >= h || by >= h) continue;
            s += L[ay * w + ax] - L[by * w + bx];
            c++;
          }
        }
        const v = c ? Math.abs(s / c) : 0;
        if (v > half[i]) half[i] = v;
      }
    }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const hy = Math.min(h - 1, y >> 1);
    for (let x = 0; x < W; x++) out[y * W + x] = half[hy * w + Math.min(w - 1, x >> 1)];
  }
  frame.line = out;
  return out;
}

/**
 * Re-extends a mask by up to `depth` pixels using only per-pixel criteria. The
 * line barriers are a few pixels wide, so this recovers the strip of wall they
 * leave next to frames and furniture without crossing back over a corner.
 */
function bandGrow(frame: Frame, m: Uint8Array, spread: number, depth: number): Uint8Array {
  const { width: w, height: h, L, A, B, edge } = frame;
  const localT = 1.4 + spread * 0.05, edgeT = 2.6 + spread * 0.09, globalT = 5 + spread * 0.32;
  let sL = 0, sA = 0, sB = 0, n = 0;
  for (let i = 0; i < m.length; i += 3) if (m[i]) { sL += L[i]; sA += A[i]; sB += B[i]; n++; }
  if (!n) return m;
  sL /= n; sA /= n; sB /= n;
  const out = m.slice();
  let frontier: number[] = [];
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const x = i % w, y = (i - x) / w;
    if ((x > 0 && !m[i - 1]) || (x < w - 1 && !m[i + 1]) || (y > 0 && !m[i - w]) || (y < h - 1 && !m[i + w])) frontier.push(i);
  }
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: number[] = [];
    for (const p of frontier) {
      const x = p % w, y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q < 0 || out[q]) continue;
        const dl = L[p] - L[q], da = A[p] - A[q], db = B[p] - B[q];
        if (dl * dl + da * da + db * db > localT * localT || edge[q] > edgeT) continue;
        const gl = 0.3 * (L[q] - sL), ga = A[q] - sA, gb = B[q] - sB;
        if (gl * gl + ga * ga + gb * gb > globalT * globalT) continue;
        out[q] = 1;
        next.push(q);
      }
    }
    frontier = next;
  }
  return out;
}

/**
 * Full edge pipeline: grow with straight-line barriers (so paint stops at wall
 * corners and the ceiling line even in noisy video), recover the strip next to
 * barriers, close small gaps, fill holes. Returns a 0–1 mask.
 */
export function classicMask(frame: Frame, seeds: Array<[number, number]>, spread: number): Float32Array {
  const { width: w, height: h } = frame;
  const line = lineEdges(frame);
  const raw = frame.edge;
  // Line evidence threshold stops loosening above Spread 45, and weighs more at high Spread.
  const scale = ((2.6 + spread * 0.09) / (2.6 + Math.min(spread, 45) * 0.09)) * (1 + Math.max(0, spread - 45) * 0.012);
  const k = LINE_WEIGHT * scale;
  const barrier = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) barrier[i] = Math.max(raw[i], line[i] * k);
  frame.edge = barrier;
  let m: Uint8Array;
  try {
    m = growRegion(frame, seeds, spread);
  } finally {
    frame.edge = raw;
  }
  m = bandGrow(frame, m, spread, Math.max(2, Math.round(Math.max(w, h) / 64)));
  m = erode(dilate(m, w, h), w, h);
  fillSmallHoles(m, w, h);
  const f = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) f[i] = m[i];
  return f;
}
