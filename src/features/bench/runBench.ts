import type { PaintSession } from "../../engine/session";

/**
 * Live-paint benchmark, opened with ?bench=ai|classic[&stable=0]. Plays a
 * recorded hand-held clip (pan, zoom, tilt, exposure drift, sensor noise,
 * compression) through the live pipeline and scores the painted area against
 * the true wall in every measured frame. Assets live in bench/ on the deployed
 * site only. Results appear on the page and in window.__bench.
 */
const W = 640, H = 480, FH = 496, GW = 160, GH = 120, FRAMES = 240;

export async function runBench(session: PaintSession, video: HTMLVideoElement, detector: "ai" | "classic", stable: boolean, shadeId: string) {
  const out = document.createElement("pre");
  out.id = "bench-result";
  out.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:99;background:#000;color:#0f0;padding:8px;font:12px monospace;max-width:96vw;white-space:pre-wrap";
  document.body.appendChild(out);
  const log = (m: string) => { out.textContent = m; };
  log("Loading benchmark…");
  const gtBuf = new Uint8Array(await (await fetch("bench/gt160.bin")).arrayBuffer());
  video.src = video.canPlayType("video/webm; codecs=vp9") ? "bench/clip.webm" : "bench/clip.mp4";
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  await new Promise((r) => setTimeout(r, 300));
  session.stabilise = stable;
  session.setDetector(detector);
  if (detector === "ai") {
    log("Waiting for the AI model…");
    const ok = await session.ai.load();
    if (!ok) { log(`AI model failed: ${session.ai.error}`); return; }
  }
  session.startLive(video);
  // Restart the clip so the tap lands on open wall.
  video.currentTime = 0;
  await new Promise((r) => setTimeout(r, 400));
  session.setShade(0, shadeId);
  session.tap(0.5, 0.5);
  log("Settling…");
  await new Promise((r) => setTimeout(r, 2000));

  const canvas = session.renderer.canvas;
  const big = document.createElement("canvas"); big.width = W; big.height = FH;
  const bg = big.getContext("2d", { willReadFrequently: true })!;
  const rows: Array<{ k: number; iou: number; cover: number; spill: number }> = [];
  const flips: number[] = [];
  let prev: Uint8Array | null = null, prevK = -1;
  const t0 = performance.now();
  while (performance.now() - t0 < 12000) {
    await new Promise((r) => requestAnimationFrame(r));
    bg.drawImage(canvas, 0, 0, W, FH);
    const d = bg.getImageData(0, 0, W, FH).data;
    let k = 0;
    for (let b = 0; b < 12; b++) if (d[((H + 8) * W + 16 + b * 20) * 4] > 127) k |= 1 << b;
    if (k >= FRAMES || k === prevK) continue;
    const painted = new Uint8Array(GW * GH);
    let inter = 0, uni = 0, gtN = 0, pN = 0;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const i = ((y * 4 + 2) * W + x * 4 + 2) * 4;
      const p = d[i] - d[i + 1] > 45 && d[i + 2] - d[i + 1] > 8 ? 1 : 0;
      const j = y * GW + x;
      const t = (gtBuf[k * (GW * GH / 8) + (j >> 3)] >> (7 - (j & 7))) & 1;
      painted[j] = p;
      if (p && t) inter++;
      if (p || t) uni++;
      gtN += t; pN += p;
    }
    if (gtN < 200) continue;
    rows.push({ k, iou: inter / uni, cover: inter / gtN, spill: (pN - inter) / gtN });
    // Blink rate: wall pixels that switch painted state between consecutive measured frames
    // (only over consecutive video frames, so camera motion contributes little).
    if (prev && k === prevK + 1) {
      let changed = 0, wall = 0;
      for (let j = 0; j < GW * GH; j++) {
        const t = (gtBuf[k * (GW * GH / 8) + (j >> 3)] >> (7 - (j & 7))) & 1;
        if (!t) continue;
        wall++;
        if (painted[j] !== prev[j]) changed++;
      }
      flips.push(changed / Math.max(1, wall));
    }
    prev = painted; prevK = k;
    if (rows.length % 10 === 0) log(`Measuring… ${rows.length} frames`);
  }
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
  const ious = rows.map((r) => r.iou).sort((a, b) => a - b);
  const result = {
    detector, stabilised: stable, frames: rows.length,
    meanIoU: +mean(ious).toFixed(3),
    worst5pctIoU: +(ious[Math.floor(ious.length * 0.05)] ?? NaN).toFixed(3),
    meanCover: +mean(rows.map((r) => r.cover)).toFixed(3),
    meanSpill: +mean(rows.map((r) => r.spill)).toFixed(3),
    blinkPerFrame: +mean(flips).toFixed(4),
    pairs: flips.length,
  };
  (window as unknown as { __bench: unknown }).__bench = result;
  log("BENCH " + JSON.stringify(result));
}
