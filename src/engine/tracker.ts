/**
 * Camera-motion tracking for live mode. Each video frame is reduced to a small
 * luminance thumbnail; block matching over a 3×3 grid gives local shifts, and a
 * weighted least-squares fit turns them into a similarity transform (shift,
 * rotation, zoom). Paint masks are warped by that transform every frame, so the
 * paint stays attached to the wall between detections. Pure functions; tested.
 */

/** 2D affine transform in normalised (0–1, y down) coordinates: x' = a·x + b·y + c, y' = d·x + e·y + f. */
export type Affine = [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 0, 1, 0];

export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
}

/** Returns m1 ∘ m2 (apply m2 first, then m1). */
export function composeAffine(m1: Affine, m2: Affine): Affine {
  return [
    m1[0] * m2[0] + m1[1] * m2[3], m1[0] * m2[1] + m1[1] * m2[4], m1[0] * m2[2] + m1[1] * m2[5] + m1[2],
    m1[3] * m2[0] + m1[4] * m2[3], m1[3] * m2[1] + m1[4] * m2[4], m1[3] * m2[2] + m1[4] * m2[5] + m1[5],
  ];
}

export function invertAffine(m: Affine): Affine {
  const det = m[0] * m[4] - m[1] * m[3];
  if (Math.abs(det) < 1e-9) return IDENTITY;
  const ia = m[4] / det, ib = -m[1] / det, id = -m[3] / det, ie = m[0] / det;
  return [ia, ib, -(ia * m[2] + ib * m[5]), id, ie, -(id * m[2] + ie * m[5])];
}

export function lumaThumb(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, out?: Float32Array): Float32Array {
  const o = out && out.length === w * h ? out : new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) o[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return o;
}

/**
 * Global translation (in thumbnail pixels) such that content at (x, y) in
 * `prev` appears at (x + dx, y + dy) in `cur`.
 */
export function estimateShift(prev: Float32Array, cur: Float32Array, w: number, h: number, maxShift = 6): [number, number] {
  const r = blockShift(prev, cur, w, h, maxShift, h - maxShift, maxShift, w - maxShift, maxShift, 2);
  return [r.dx, r.dy];
}

interface BlockResult { dx: number; dy: number; weight: number }

function blockShift(prev: Float32Array, cur: Float32Array, w: number, h: number, y0: number, y1: number, x0: number, x1: number, m: number, step = 1, ox = 0, oy = 0): BlockResult {
  let best = Infinity, bx = 0, by = 0, sumScores = 0, nScores = 0;
  // Texture of the block: flat blocks (plain wall) give no reliable motion.
  let mean = 0, n0 = 0;
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) { mean += prev[y * w + x]; n0++; }
  mean /= Math.max(1, n0);
  let varSum = 0;
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) { const d = prev[y * w + x] - mean; varSum += d * d; }
  const std = Math.sqrt(varSum / Math.max(1, n0));
  for (let dy = oy - m; dy <= oy + m; dy++) {
    for (let dx = ox - m; dx <= ox + m; dx++) {
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y += step) {
        const yc = y + dy;
        if (yc < 0 || yc >= h) continue;
        for (let x = x0; x < x1; x += step) {
          const xc = x + dx;
          if (xc < 0 || xc >= w) continue;
          sum += Math.abs(prev[y * w + x] - cur[yc * w + xc]);
          n++;
        }
      }
      if (!n) continue;
      const score = sum / n + 0.02 * (Math.abs(dx - ox) + Math.abs(dy - oy));
      sumScores += score;
      nScores++;
      if (score < best) { best = score; bx = dx; by = dy; }
    }
  }
  const avg = sumScores / Math.max(1, nScores);
  // Distinctiveness of the best match times texture strength.
  const distinct = avg > 1e-6 ? Math.max(0, (avg - best) / avg) : 0;
  const weight = distinct * Math.min(1, Math.max(0, (std - 2) / 10));
  return { dx: bx, dy: by, weight };
}

export interface Motion {
  /** Maps previous-frame normalised coordinates to current-frame coordinates. */
  xf: Affine;
  /** 0–1: how much of the frame had trackable texture. */
  confidence: number;
}

/**
 * Similarity-transform motion between two thumbnails. Falls back to pure
 * translation when too few blocks are trackable, and to no motion when none are.
 */
function half(src: Float32Array, w: number, h: number): Float32Array {
  const hw = w >> 1, hh = h >> 1, o = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const i = 2 * y * w + 2 * x;
    o[y * hw + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1]) / 4;
  }
  return o;
}

export function estimateMotion(prev: Float32Array, cur: Float32Array, w: number, h: number, maxShift = 6, grid = 3): Motion {
  // Coarse-to-fine: a global search at half resolution catches fast pans
  // (up to 2·maxShift pixels), then blocks refine around it at full resolution.
  const hw = w >> 1, hh = h >> 1;
  const coarse = blockShift(half(prev, w, h), half(cur, w, h), hw, hh, maxShift, hh - maxShift, maxShift, hw - maxShift, maxShift, 1);
  const ox = coarse.weight > 0.02 ? coarse.dx * 2 : 0, oy = coarse.weight > 0.02 ? coarse.dy * 2 : 0;
  const fine = 3;
  const pts: Array<{ x: number; y: number; dx: number; dy: number; wt: number }> = [];
  const bw = Math.floor(w / grid), bh = Math.floor(h / grid);
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x0 = gx * bw + (gx === 0 ? maxShift : 1), x1 = (gx + 1) * bw - (gx === grid - 1 ? maxShift : 1);
      const y0 = gy * bh + (gy === 0 ? maxShift : 1), y1 = (gy + 1) * bh - (gy === grid - 1 ? maxShift : 1);
      const r = blockShift(prev, cur, w, h, y0, y1, x0, x1, fine, 1, ox, oy);
      pts.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, dx: r.dx, dy: r.dy, wt: r.weight });
    }
  }
  const W = pts.reduce((s, p) => s + p.wt, 0);
  const strong = pts.filter((p) => p.wt > 0.05).length;
  const confidence = Math.min(1, W / (grid * grid * 0.35));
  if (W < 0.05) {
    // Blocks too flat to trust individually; use the global estimate if it is reliable.
    if (coarse.weight > 0.05 && (ox || oy)) return { xf: [1, 0, ox / w, 0, 1, oy / h], confidence: Math.min(1, coarse.weight) };
    return { xf: IDENTITY, confidence: 0 };
  }

  // Weighted centroids of source and target points.
  let sx = 0, sy = 0, tx = 0, ty = 0;
  for (const p of pts) { sx += p.wt * p.x; sy += p.wt * p.y; tx += p.wt * (p.x + p.dx); ty += p.wt * (p.y + p.dy); }
  sx /= W; sy /= W; tx /= W; ty /= W;
  let a = 1, b = 0;
  if (strong >= 3) {
    // Least-squares similarity: q - qc = [a -b; b a](p - pc).
    let num1 = 0, num2 = 0, den = 0;
    for (const p of pts) {
      const px = p.x - sx, py = p.y - sy, qx = p.x + p.dx - tx, qy = p.y + p.dy - ty;
      num1 += p.wt * (px * qx + py * qy);
      num2 += p.wt * (px * qy - py * qx);
      den += p.wt * (px * px + py * py);
    }
    if (den > 1e-6) { a = num1 / den; b = num2 / den; }
    // Hand-held motion between consecutive frames is small; clamp outliers.
    const s = Math.hypot(a, b), ang = Math.atan2(b, a);
    const sc = Math.min(1.06, Math.max(0.94, s)), an = Math.max(-0.05, Math.min(0.05, ang));
    a = sc * Math.cos(an);
    b = sc * Math.sin(an);
  }
  // Pixel-space transform q = R·p + t, with t chosen so the centroids map.
  const cx = tx - (a * sx - b * sy), cy = ty - (b * sx + a * sy);
  // Convert to normalised coordinates.
  const xf: Affine = [a, -b * (h / w), cx / w, b * (w / h), a, cy / h];
  return { xf, confidence };
}

/**
 * Resamples `src` (w×h, normalised coordinates) through `curToSrc`, which maps
 * each output pixel's normalised position to a position in `src`. Bilinear.
 * Pixels that map outside `src` get `outside` (use -1 to mark "no history").
 */
export function warpMask(src: Float32Array, w: number, h: number, curToSrc: Affine, out?: Float32Array, outside = 0): Float32Array {
  const o = out && out.length === w * h ? out : new Float32Array(w * h);
  const [a, b, c, d, e, f] = curToSrc;
  for (let y = 0; y < h; y++) {
    const ny = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5) / w;
      const sx = (a * nx + b * ny + c) * w - 0.5, sy = (d * nx + e * ny + f) * h - 0.5;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      // Pixels that were outside the previous frame have no history.
      if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > h - 0.5) { o[y * w + x] = outside; continue; }
      const fx = sx - x0, fy = sy - y0;
      const g = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : src[yy * w + xx]);
      o[y * w + x] = (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  return o;
}

/** Intersection over union of two masks thresholded at 0.5. 1 when both are empty. */
export function maskIoU(a: Float32Array, b: Float32Array): number {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] > 0.5, y = b[i] > 0.5;
    if (x && y) inter++;
    if (x || y) uni++;
  }
  return uni ? inter / uni : 1;
}

/**
 * Nudges a seed toward the interior of its mask so it does not slip off an edge
 * as the camera moves. Returns the new normalised point.
 */
export function recentreSeed(mask: Float32Array, w: number, h: number, seed: [number, number], radius = 0.12, pull = 0.25): [number, number] {
  const cx = seed[0] * w, cy = seed[1] * h;
  const r = Math.max(4, radius * Math.max(w, h));
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  let sx = 0, sy = 0, n = 0;
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      if (mask[y * w + x] > 0.5) { sx += x; sy += y; n++; }
    }
  }
  if (!n) return seed;
  const tx = sx / n, ty = sy / n;
  return [Math.min(0.99, Math.max(0.01, (cx + (tx - cx) * pull) / w)), Math.min(0.99, Math.max(0.01, (cy + (ty - cy) * pull) / h))];
}
