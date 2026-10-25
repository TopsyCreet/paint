/**
 * Cheap camera-motion tracking for live mode. Estimates the global shift between
 * two small luminance thumbnails by block matching, so tapped points follow the
 * wall when the phone pans. Pure functions; unit tested.
 */

export function lumaThumb(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, out?: Float32Array): Float32Array {
  const o = out && out.length === w * h ? out : new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) o[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return o;
}

/**
 * Returns [dx, dy] in thumbnail pixels such that content at (x, y) in `prev`
 * appears at (x + dx, y + dy) in `cur`. Uses mean absolute difference over the
 * overlapping area, ignoring a border of `maxShift`.
 */
export function estimateShift(prev: Float32Array, cur: Float32Array, w: number, h: number, maxShift = 6): [number, number] {
  let best = Infinity, bx = 0, by = 0;
  const m = maxShift;
  for (let dy = -m; dy <= m; dy++) {
    for (let dx = -m; dx <= m; dx++) {
      let sum = 0, n = 0;
      for (let y = m; y < h - m; y += 2) {
        const yc = y + dy;
        for (let x = m; x < w - m; x += 2) {
          sum += Math.abs(prev[y * w + x] - cur[yc * w + x + dx]);
          n++;
        }
      }
      const score = sum / n + 0.02 * (Math.abs(dx) + Math.abs(dy));
      if (score < best) { best = score; bx = dx; by = dy; }
    }
  }
  return [bx, by];
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
