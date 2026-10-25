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
