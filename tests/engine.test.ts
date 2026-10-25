import { describe, expect, it } from "vitest";
import { analyseFrame, classicMask, fillSmallHoles } from "../src/engine/classicSegmenter";
import { estimateShift, recentreSeed } from "../src/engine/tracker";

/** Synthetic 80×60 "room": left wall, right wall with a shading gradient, and a dark frame on the right wall. */
function room(): Uint8ClampedArray {
  const w = 80, h = 60, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let c: [number, number, number];
    if (x < 30) c = [230, 225, 215];
    else c = [200 - (x - 30) * 0.6, 210 - (x - 30) * 0.6, 220 - (x - 30) * 0.6];
    if (x >= 50 && x < 60 && y >= 20 && y < 30) c = [40, 40, 45];
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  return d;
}

describe("classic segmenter", () => {
  it("fills one wall and stops at the edge", () => {
    const f = analyseFrame(room(), 80, 60);
    const m = classicMask(f, [[0.1, 0.5]], 45);
    expect(m[30 * 80 + 10]).toBe(1); // inside left wall
    expect(m[30 * 80 + 40]).toBe(0); // right wall untouched
  });

  it("follows shading across a wall but excludes a dark frame", () => {
    const f = analyseFrame(room(), 80, 60);
    const m = classicMask(f, [[0.5, 0.8]], 45);
    expect(m[50 * 80 + 75]).toBe(1); // far, darker end of the same wall
    expect(m[25 * 80 + 55]).toBe(0); // the frame
    expect(m[30 * 80 + 10]).toBe(0); // the other wall
  });

  it("fills small enclosed holes", () => {
    const w = 10, h = 10, m = new Uint8Array(w * h).fill(1);
    m[55] = 0;
    fillSmallHoles(m, w, h, 0.05);
    expect(m[55]).toBe(1);
  });
});

describe("live tracker", () => {
  it("estimates a camera pan", () => {
    const w = 80, h = 60, a = new Float32Array(w * h), b = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = (x * 7 + y * 13) % 31 + Math.sin(x / 3) * 20 + Math.cos(y / 4) * 15;
      a[y * w + x] = v;
    }
    // b = a shifted right by 3 and down by 2
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = x - 3, sy = y - 2;
      b[y * w + x] = sx >= 0 && sy >= 0 ? a[sy * w + sx] : 0;
    }
    expect(estimateShift(a, b, w, h, 6)).toEqual([3, 2]);
  });

  it("pulls a seed toward the interior of its mask", () => {
    const w = 40, h = 40, m = new Float32Array(w * h);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) m[y * w + x] = 1;
    const [x] = recentreSeed(m, w, h, [11 / 40, 0.5], 0.3, 0.5);
    expect(x).toBeGreaterThan(11 / 40);
  });
});

import { IDENTITY, applyAffine, composeAffine, estimateMotion, invertAffine, maskIoU, warpMask } from "../src/engine/tracker";
import { cleanMask, keepSeedRegions } from "../src/engine/classicSegmenter";

function texture(w: number, h: number, ox = 0, oy = 0): Float32Array {
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x - ox, Y = y - oy;
    a[y * w + x] = 128 + 60 * Math.sin(X / 2.3) * Math.cos(Y / 3.1) + 40 * Math.sin((X + Y) / 5.7);
  }
  return a;
}

describe("motion model", () => {
  it("recovers a pan as a normalised transform", () => {
    const w = 96, h = 72;
    const m = estimateMotion(texture(w, h), texture(w, h, 4, -3), w, h, 6);
    const [x, y] = applyAffine(m.xf, 0.5, 0.5);
    expect(x * w - 0.5 * w).toBeCloseTo(4, 0);
    expect(y * h - 0.5 * h).toBeCloseTo(-3, 0);
    expect(m.confidence).toBeGreaterThan(0.3);
  });

  it("reports no motion on a blank wall", () => {
    const w = 96, h = 72, flat = new Float32Array(w * h).fill(200);
    const m = estimateMotion(flat, flat, w, h);
    expect(m.confidence).toBe(0);
    expect(m.xf).toEqual(IDENTITY);
  });

  it("composes and inverts transforms", () => {
    const a: [number, number, number, number, number, number] = [1.02, 0.01, 0.03, -0.01, 1.02, -0.02];
    const id = composeAffine(a, invertAffine(a));
    id.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i], 9));
  });

  it("warps a mask and marks pixels with no history", () => {
    const w = 20, h = 10, m = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < 10; x++) m[y * w + x] = 1;
    // Camera moved right by 5 px: current pixel x samples previous x + 5.
    const out = warpMask(m, w, h, [1, 0, 5 / w, 0, 1, 0], undefined, -1);
    expect(out[5 * w + 2]).toBeCloseTo(1, 5);
    expect(out[5 * w + 8]).toBeCloseTo(0, 5);
    expect(out[5 * w + 19]).toBe(-1);
    expect(maskIoU(m, m)).toBe(1);
  });
});

describe("mask cleanup", () => {
  it("keeps only the tapped region and fills its holes", () => {
    const w = 30, h = 20, soft = new Float32Array(w * h);
    for (let y = 2; y < 18; y++) for (let x = 2; x < 14; x++) soft[y * w + x] = 0.9;
    soft[10 * w + 8] = 0.1; // hole
    for (let y = 5; y < 8; y++) for (let x = 22; x < 26; x++) soft[y * w + x] = 0.9; // stray blob
    const m = cleanMask(soft, w, h, [[0.2, 0.5]]);
    expect(m[10 * w + 8]).toBe(1);
    expect(m[6 * w + 23]).toBe(0);
    const k = keepSeedRegions(Uint8Array.from(soft, (v) => (v > 0.5 ? 1 : 0)), w, h, [[0.8, 0.3]]);
    expect(k[6 * w + 23]).toBe(1);
    expect(k[10 * w + 5]).toBe(0);
  });
});
