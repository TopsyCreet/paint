import type { Finish } from "../data/types";
import { AiSegmenter, type AiStatus } from "./aiSegmenter";
import { analyseFrame, classicMask, cleanMask, keepSeedRegions, type Frame } from "./classicSegmenter";
import { MAX_SURFACES, PaintRenderer, type SurfaceLayer } from "./renderer";
import { IDENTITY, applyAffine, composeAffine, estimateMotion, invertAffine, lumaThumb, maskIoU, recentreSeed, warpMask, type Affine } from "./tracker";
import type { RGB } from "./colour";

export type Detector = "ai" | "classic";
export type Tool = "tap" | "brush" | "erase" | "match";
export type SourceKind = "room" | "photo" | "live" | "project";

export interface Surface {
  id: string;
  shadeId: string;
  finish: Finish;
  seeds: Array<[number, number]>;
  /** Detector output, 0–1. Never mutated after creation (history shares it). */
  seg: Float32Array | null;
  /** Brush edits. Copied before each stroke, so history snapshots stay intact. */
  add: Uint8Array | null;
  erase: Uint8Array | null;
  /** Composed result: seg + add − erase. */
  mask: Float32Array | null;
  base: number;
  method: Detector | "saved";
  /** Mean chromaticity of the original wall (for edge refinement). */
  chroma: [number, number, number] | null;
  /** Live mode: smoothed detection probability, and consecutive rejected detections. */
  prob?: Float32Array | null;
  rejects?: number;
}

export interface SurfaceView {
  id: string;
  shadeId: string;
  finish: Finish;
  painted: boolean;
  method: Surface["method"];
  coverage: number;
}

export interface SessionState {
  ready: boolean;
  sourceKind: SourceKind;
  live: boolean;
  surfaces: SurfaceView[];
  selected: number;
  tool: Tool;
  spread: number;
  brushSize: number;
  compare: boolean;
  split: number;
  canUndo: boolean;
  canRedo: boolean;
  detector: Detector;
  ai: AiStatus;
  aiError: string;
  busy: boolean;
  aspect: number;
}

export interface PresetSurface {
  shadeId: string;
  finish?: Finish;
  seeds: Array<[number, number]>;
}

export interface SavedSurface {
  shadeId: string;
  finish: Finish;
  seeds: Array<[number, number]>;
  /** Composed mask quantised to 0–255 at maskW×maskH. */
  mask: Uint8Array | null;
}

export interface SessionSnapshot {
  image: Blob;
  maskW: number;
  maskH: number;
  surfaces: SavedSurface[];
}

type Listener = (s: SessionState) => void;

const MAX_SOURCE = 2048;
const MAX_ANALYSIS = 512;
const MAX_LIVE_ANALYSIS = 320;
const THUMB = 96;
const DETECT_INTERVAL = 100;
const HISTORY_LIMIT = 30;
let uid = 0;
const newId = () => `s${Date.now().toString(36)}${(uid++).toString(36)}`;

export class PaintSession {
  readonly renderer: PaintRenderer;
  readonly ai: AiSegmenter;
  private sourceCanvas = document.createElement("canvas");
  private analysisCanvas = document.createElement("canvas");
  private actx = this.analysisCanvas.getContext("2d", { willReadFrequently: true })!;
  private frame: Frame | null = null;
  private rgba: Uint8ClampedArray | null = null;
  private surfaces: Surface[] = [];
  private undoStack: Surface[][] = [];
  private redoStack: Surface[][] = [];
  private listeners = new Set<Listener>();
  private state: SessionState;
  private stroke: { idx: number } | null = null;
  // Live camera
  private video: HTMLVideoElement | null = null;
  private liveRaf = 0;
  private liveVfc = 0;
  private liveGen = 0;
  private lastTick = 0;
  private robin = 0;
  private prevThumb: Float32Array | null = null;
  private thumbW = THUMB;
  private thumbH = 54;
  /** Maps the displayed camera frame to the frame the masks were computed in. */
  private liveXf: Affine = IDENTITY;
  private thumbCanvas = document.createElement("canvas");
  private tctx = this.thumbCanvas.getContext("2d", { willReadFrequently: true })!;
  onNotice: (msg: string) => void = () => {};
  /** false reproduces the earlier live method (no per-frame warping or fusion), for A/B benchmarks. */
  stabilise = true;

  constructor(canvas: HTMLCanvasElement, ai: AiSegmenter, private defaultShade: () => string) {
    this.renderer = new PaintRenderer(canvas);
    this.ai = ai;
    this.state = {
      ready: false, sourceKind: "room", live: false, surfaces: [], selected: 0, tool: "tap", spread: 45, brushSize: 0.04,
      compare: false, split: 0.5, canUndo: false, canRedo: false, detector: ai.status === "disabled" ? "classic" : "ai",
      ai: ai.status, aiError: ai.error, busy: false, aspect: 1.5,
    };
    ai.onChange(() => {
      const upgrade = ai.status === "ready" && this.state.detector === "ai";
      this.patch({ ai: ai.status, aiError: ai.error });
      if (ai.status === "failed" && this.state.detector === "ai") {
        this.patch({ detector: "classic" });
        this.onNotice("Smart detection couldn't load, so edge detection is on. Painting still works.");
      }
      if (upgrade && !this.state.live) this.upgradeToAi();
    });
  }

  // ---------- state plumbing ----------
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }
  getState(): SessionState { return this.state; }
  private patch(p: Partial<SessionState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((fn) => fn(this.state));
  }
  private views(): SurfaceView[] {
    const n = this.maskW * this.maskH || 1;
    return this.surfaces.map((s) => {
      let cov = 0;
      if (s.mask) for (let i = 0; i < s.mask.length; i += 4) cov += s.mask[i];
      return { id: s.id, shadeId: s.shadeId, finish: s.finish, painted: !!s.mask, method: s.method, coverage: Math.min(1, (cov * 4) / n) };
    });
  }
  private sync(extra: Partial<SessionState> = {}) {
    this.patch({ surfaces: this.views(), canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, ...extra });
    this.upload();
  }
  get maskW() { return this.analysisCanvas.width; }
  get maskH() { return this.analysisCanvas.height; }

  private upload() {
    const layers: SurfaceLayer[] = this.surfaces.map((s) => ({ mask: s.mask, hex: this.hexFor(s.shadeId), finish: s.finish, base: s.base, chroma: s.chroma }));
    this.renderer.setSurfaces(this.maskW, this.maskH, layers);
    this.renderer.setCompare(this.state.compare, this.state.split);
    this.renderer.requestRender();
  }
  hexFor: (shadeId: string) => string = () => "#CCCCCC";

  // ---------- history ----------
  private snapshot(): Surface[] { return this.surfaces.map((s) => ({ ...s, seeds: s.seeds.slice() })); }
  private pushHistory() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshot());
    this.surfaces = prev;
    this.sync({ selected: Math.min(this.state.selected, Math.max(0, prev.length - 1)) });
  }
  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.surfaces = next;
    this.sync({ selected: Math.min(this.state.selected, Math.max(0, next.length - 1)) });
  }

  // ---------- loading sources ----------
  loadImage(image: CanvasImageSource, width: number, height: number, kind: SourceKind, preset: PresetSurface[] = []) {
    this.stopLive();
    const sc = Math.min(1, MAX_SOURCE / Math.max(width, height));
    this.sourceCanvas.width = Math.round(width * sc);
    this.sourceCanvas.height = Math.round(height * sc);
    const sctx = this.sourceCanvas.getContext("2d")!;
    sctx.drawImage(image, 0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
    this.prepareAnalysis(this.sourceCanvas, this.sourceCanvas.width, this.sourceCanvas.height, MAX_ANALYSIS);
    this.renderer.setImageSource(this.sourceCanvas);
    this.liveXf = IDENTITY;
    this.renderer.setMaskTransform(IDENTITY);
    this.undoStack = [];
    this.redoStack = [];
    this.surfaces = preset.length
      ? preset.slice(0, MAX_SURFACES).map((p) => this.blankSurface(p.shadeId, p.finish, p.seeds))
      : [this.blankSurface(this.defaultShade())];
    for (const s of this.surfaces) if (s.seeds.length) this.segmentSurface(s);
    this.sync({ ready: true, sourceKind: kind, live: false, selected: 0, compare: false, aspect: width / height });
    if (this.state.detector === "ai" && this.ai.status === "idle") void this.ai.load();
  }

  private prepareAnalysis(src: CanvasImageSource, w: number, h: number, maxSide: number) {
    const sc = Math.min(1, maxSide / Math.max(w, h));
    const aw = Math.max(16, Math.round(w * sc)), ah = Math.max(16, Math.round(h * sc));
    if (this.analysisCanvas.width !== aw || this.analysisCanvas.height !== ah) {
      this.analysisCanvas.width = aw;
      this.analysisCanvas.height = ah;
    }
    this.actx.imageSmoothingQuality = "high";
    this.actx.drawImage(src, 0, 0, aw, ah);
    const data = this.actx.getImageData(0, 0, aw, ah).data;
    this.rgba = data;
    this.frame = analyseFrame(data, aw, ah, this.frame ?? undefined);
  }

  private blankSurface(shadeId: string, finish: Finish = "matt", seeds: Array<[number, number]> = []): Surface {
    return { id: newId(), shadeId, finish, seeds: seeds.slice(), seg: null, add: null, erase: null, mask: null, base: 0.5, method: this.state.detector, chroma: null };
  }

  // ---------- segmentation ----------
  private detect(seeds: Array<[number, number]>): { mask: Float32Array; method: Detector } | null {
    if (!this.frame || !seeds.length) return null;
    const w = this.maskW, h = this.maskH;
    if (this.state.detector === "ai" && this.ai.ready) {
      const m = this.ai.segment(this.analysisCanvas, seeds);
      // The raw model output can be patchy: close gaps, fill holes, drop stray blobs.
      if (m) return { mask: cleanMask(m, w, h, seeds), method: "ai" };
    }
    return { mask: classicMask(this.frame, seeds, this.state.spread), method: "classic" };
  }

  private segmentSurface(s: Surface) {
    const r = this.detect(s.seeds);
    s.seg = r ? r.mask : null;
    s.method = r ? r.method : s.method;
    this.compose(s);
  }

  private compose(s: Surface) {
    const n = this.maskW * this.maskH;
    if (!s.seg && !s.add) { s.mask = null; return; }
    const m = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = s.seg ? s.seg[i] : 0;
      if (s.add && s.add[i]) v = 1;
      if (s.erase && s.erase[i]) v = 0;
      m[i] = v;
    }
    let any = false;
    for (let i = 0; i < n; i += 7) if (m[i] > 0.5) { any = true; break; }
    s.mask = any ? m : null;
    s.base = this.medianLuminance(m);
    s.chroma = any ? this.meanChroma(m) : null;
  }

  /** Average chromaticity (r, g, b divided by their sum) of the original pixels under a mask. */
  private meanChroma(mask: Float32Array): [number, number, number] | null {
    const d = this.rgba;
    if (!d || d.length !== mask.length * 4) return null;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < mask.length; i += 2) {
      if (mask[i] < 0.5) continue;
      const R = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2], sum = R + G + B;
      if (sum < 30) continue; // very dark pixels have unreliable colour
      r += R / sum; g += G / sum; b += B / sum; n++;
    }
    return n > 20 ? [r / n, g / n, b / n] : null;
  }

  private medianLuminance(mask: Float32Array): number {
    if (!this.frame) return 0.5;
    const hist = new Uint32Array(256);
    let n = 0;
    const Y = this.frame.Y;
    for (let i = 0; i < mask.length; i++) if (mask[i] > 0.5) { hist[Math.min(255, Math.floor(Math.sqrt(Y[i]) * 255))]++; n++; }
    if (!n) return 0.5;
    let acc = 0;
    for (let b = 0; b < 256; b++) {
      acc += hist[b];
      if (acc >= n / 2) { const v = (b + 0.5) / 255; return v * v; }
    }
    return 0.5;
  }

  private upgradeToAi() {
    const targets = this.surfaces.filter((s) => s.method === "classic" && s.seeds.length && !s.add && !s.erase);
    if (!targets.length || !this.ai.ready) return;
    for (const s of targets) this.segmentSurface(s);
    this.sync();
  }

  // ---------- interaction ----------
  tap(nx: number, ny: number) {
    if (!this.state.ready || nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
    let s = this.surfaces[this.state.selected];
    if (!s) return;
    if (this.state.live) {
      s.seeds = [[nx, ny]];
      s.prob = null;
      s.rejects = 0;
      this.detectTick(this.state.selected, true);
      return;
    }
    this.pushHistory();
    s = this.surfaces[this.state.selected] = { ...s, seeds: [...s.seeds, [nx, ny]] };
    this.patch({ busy: true });
    this.segmentSurface(s);
    if (!s.mask) this.onNotice("Nothing was detected there. Try tapping the middle of the wall, or raise Spread.");
    this.sync({ busy: false });
  }

  beginStroke() {
    const s = this.surfaces[this.state.selected];
    if (!s || this.state.live) return;
    this.pushHistory();
    const n = this.maskW * this.maskH;
    const copy = { ...s, add: s.add ? s.add.slice() : new Uint8Array(n), erase: s.erase ? s.erase.slice() : new Uint8Array(n) };
    this.surfaces[this.state.selected] = copy;
    this.stroke = { idx: this.state.selected };
  }

  strokeTo(nx: number, ny: number, px?: number, py?: number) {
    if (!this.stroke) return;
    const s = this.surfaces[this.stroke.idx];
    const w = this.maskW, h = this.maskH;
    const r = Math.max(1.5, this.state.brushSize * Math.max(w, h));
    const erasing = this.state.tool === "erase";
    const steps = px === undefined || py === undefined ? 1 : Math.max(1, Math.ceil(Math.hypot((nx - px) * w, (ny - py) * h) / (r * 0.4)));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const cx = ((px ?? nx) + (nx - (px ?? nx)) * t) * w, cy = ((py ?? ny) + (ny - (py ?? ny)) * t) * h;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        const i = y * w + x;
        if (erasing) { s.erase![i] = 1; s.add![i] = 0; } else { s.add![i] = 1; s.erase![i] = 0; }
      }
    }
    this.compose(s);
    this.upload();
  }

  endStroke() {
    if (!this.stroke) return;
    this.stroke = null;
    this.sync();
  }

  /** Average colour of the original photo around a point (for colour matching). */
  sampleColour(nx: number, ny: number): RGB | null {
    const src = this.state.live && this.video ? this.analysisCanvas : this.sourceCanvas;
    const ctx = src.getContext("2d", { willReadFrequently: true });
    if (!ctx || !src.width) return null;
    const r = Math.max(2, Math.round(Math.min(src.width, src.height) * 0.006));
    const x = Math.round(nx * src.width), y = Math.round(ny * src.height);
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
    const d = ctx.getImageData(x0, y0, Math.min(src.width - x0, r * 2 + 1), Math.min(src.height - y0, r * 2 + 1)).data;
    let R = 0, G = 0, B = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
    return n ? [R / n, G / n, B / n] : null;
  }

  selectSurface(i: number) {
    if (i >= 0 && i < this.surfaces.length) this.patch({ selected: i });
  }

  addSurface(shadeId?: string): boolean {
    if (this.surfaces.length >= MAX_SURFACES) return false;
    this.pushHistory();
    this.surfaces = [...this.surfaces, this.blankSurface(shadeId ?? this.defaultShade())];
    this.sync({ selected: this.surfaces.length - 1 });
    return true;
  }

  removeSurface(i: number) {
    if (!this.surfaces[i]) return;
    this.pushHistory();
    this.surfaces = this.surfaces.filter((_, k) => k !== i);
    if (!this.surfaces.length) this.surfaces = [this.blankSurface(this.defaultShade())];
    this.sync({ selected: Math.max(0, Math.min(this.state.selected, this.surfaces.length - 1)) });
  }

  clearSurface(i: number) {
    const s = this.surfaces[i];
    if (!s || (!s.mask && !s.seeds.length)) return;
    if (!this.state.live) this.pushHistory();
    this.surfaces[i] = { ...s, seeds: [], seg: null, add: null, erase: null, mask: null, base: 0.5 };
    this.sync();
  }

  setShade(i: number, shadeId: string) {
    const s = this.surfaces[i];
    if (!s || s.shadeId === shadeId) return;
    if (!this.state.live) this.pushHistory();
    this.surfaces[i] = { ...s, shadeId };
    this.sync();
  }

  setFinish(i: number, finish: Finish) {
    const s = this.surfaces[i];
    if (!s || s.finish === finish) return;
    this.pushHistory();
    this.surfaces[i] = { ...s, finish };
    this.sync();
  }

  setTool(tool: Tool) { this.patch({ tool }); }
  setBrushSize(v: number) { this.patch({ brushSize: v }); }

  setSpread(v: number) {
    this.patch({ spread: v });
    if (this.state.live) return;
    let changed = false;
    this.surfaces = this.surfaces.map((s) => {
      if (s.method !== "classic" || !s.seeds.length) return s;
      const copy = { ...s };
      this.segmentSurface(copy);
      changed = true;
      return copy;
    });
    if (changed) this.sync();
  }

  setDetector(d: Detector) {
    if (d === this.state.detector) return;
    this.patch({ detector: d });
    if (d === "ai" && !this.ai.ready) {
      void this.ai.load();
      return;
    }
    if (this.state.live) return;
    this.pushHistory();
    this.surfaces = this.surfaces.map((s) => {
      if (!s.seeds.length) return s;
      const copy = { ...s };
      this.segmentSurface(copy);
      return copy;
    });
    this.sync();
  }

  setCompare(on: boolean) {
    this.patch({ compare: on, split: 0.5 });
    this.upload();
  }
  setSplit(v: number) {
    this.patch({ split: Math.min(1, Math.max(0, v)) });
    this.renderer.setCompare(this.state.compare, this.state.split);
    this.renderer.requestRender();
  }

  // ---------- live camera ----------
  startLive(video: HTMLVideoElement) {
    this.stopLive();
    this.video = video;
    const keep = this.surfaces.map((s) => ({ ...s, seeds: [] as Array<[number, number]>, seg: null, add: null, erase: null, mask: null, base: 0.5, chroma: null, prob: null, rejects: 0 }));
    this.surfaces = keep.length ? keep : [this.blankSurface(this.defaultShade())];
    this.undoStack = [];
    this.redoStack = [];
    this.prepareAnalysis(video, video.videoWidth, video.videoHeight, MAX_LIVE_ANALYSIS);
    this.renderer.setImageSource(video);
    const land = video.videoWidth >= video.videoHeight;
    this.thumbW = land ? THUMB : Math.round((THUMB * video.videoWidth) / video.videoHeight);
    this.thumbH = land ? Math.round((THUMB * video.videoHeight) / video.videoWidth) : THUMB;
    this.thumbCanvas.width = this.thumbW;
    this.thumbCanvas.height = this.thumbH;
    this.prevThumb = null;
    this.liveXf = IDENTITY;
    this.renderer.setMaskTransform(IDENTITY);
    this.sync({ ready: true, live: true, sourceKind: "live", compare: false, tool: "tap", aspect: video.videoWidth / video.videoHeight });
    if (this.state.detector === "ai" && this.ai.status === "idle") void this.ai.load();

    // Process every new camera frame: track motion, occasionally re-detect, render.
    const gen = ++this.liveGen;
    type VfcVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (id: number) => void };
    const v = video as VfcVideo;
    const step = () => {
      if (gen !== this.liveGen || !this.video) return;
      if (this.video.readyState >= 2) this.onLiveFrame(performance.now());
      if (v.requestVideoFrameCallback) this.liveVfc = v.requestVideoFrameCallback(step);
      else this.liveRaf = requestAnimationFrame(step);
    };
    if (v.requestVideoFrameCallback) this.liveVfc = v.requestVideoFrameCallback(step);
    else this.liveRaf = requestAnimationFrame(step);
  }

  private onLiveFrame(now: number) {
    const v = this.video!;
    // 1. Camera motion since the previous frame, from a small luminance thumbnail.
    this.tctx.drawImage(v, 0, 0, this.thumbW, this.thumbH);
    const thumb = lumaThumb(this.tctx.getImageData(0, 0, this.thumbW, this.thumbH).data, this.thumbW, this.thumbH);
    if (this.prevThumb) {
      const motion = estimateMotion(this.prevThumb, thumb, this.thumbW, this.thumbH, 6);
      if (motion.confidence > 0) {
        this.liveXf = composeAffine(this.liveXf, invertAffine(motion.xf));
        for (const s of this.surfaces) s.seeds = s.seeds.map(([x, y]) => applyAffine(motion.xf, x, y).map((c) => Math.min(0.99, Math.max(0.01, c))) as [number, number]);
      }
    }
    this.prevThumb = thumb;
    // 2. Re-detect one wall every ~100 ms.
    if (now - this.lastTick > DETECT_INTERVAL) {
      this.lastTick = now;
      this.detectTick();
    }
    // 3. Draw with the masks warped onto this exact frame.
    this.renderer.setMaskTransform(this.stabilise ? this.liveXf : IDENTITY);
    this.renderer.render();
  }

  /**
   * Brings every mask into the current frame, then detects one wall and fuses
   * the result with its history (outlier rejection + hysteresis), so the paint
   * neither flickers nor lags behind camera movement.
   */
  private detectTick(only?: number, reset = false) {
    const v = this.video;
    if (!v || !v.videoWidth) return;
    this.prepareAnalysis(v, v.videoWidth, v.videoHeight, MAX_LIVE_ANALYSIS);
    const w = this.maskW, h = this.maskH, n = w * h;
    const moved = this.stabilise && this.liveXf.some((x, i) => Math.abs(x - IDENTITY[i]) > 1e-4);
    for (const s of this.surfaces) {
      if (s.seg && s.seg.length !== n) { s.seg = null; s.prob = null; }
      if (moved && s.seg) {
        s.seg = warpMask(s.seg, w, h, this.liveXf);
        if (s.prob) s.prob = warpMask(s.prob, w, h, this.liveXf, undefined, -1);
      }
    }
    this.liveXf = IDENTITY;
    this.renderer.setMaskTransform(IDENTITY);

    const active = this.surfaces.map((s, i) => (s.seeds.length ? i : -1)).filter((i) => i >= 0);
    const target = only ?? (active.length ? active[this.robin++ % active.length] : -1);
    const s = this.surfaces[target];
    if (s && s.seeds.length) {
      const r = this.detect(s.seeds);
      if (r) {
        s.method = r.method;
        if (this.stabilise) this.fuse(s, r.mask, reset, w, h);
        else {
          const prev = s.seg;
          if (prev && prev.length === r.mask.length && !reset) for (let k = 0; k < r.mask.length; k++) r.mask[k] = prev[k] * 0.4 + r.mask[k] * 0.6;
          s.seg = r.mask;
        }
        if (s.seg) {
          const chroma = this.meanChroma(s.seg);
          if (chroma) s.chroma = s.chroma ? (s.chroma.map((c, k) => c * 0.7 + chroma[k] * 0.3) as [number, number, number]) : chroma;
          const base = this.medianLuminance(s.seg);
          s.base = reset || !s.mask ? base : s.base * 0.8 + base * 0.2;
          s.seeds = [recentreSeed(s.seg, w, h, s.seeds[0])];
        }
      }
    }
    for (const x of this.surfaces) x.mask = x.seg;
    this.sync();
  }

  private fuse(s: Surface, d: Float32Array, reset: boolean, w: number, h: number) {
    const n = d.length;
    if (reset || !s.seg || !s.prob || s.prob.length !== n) {
      s.seg = d;
      s.prob = d.slice();
      s.rejects = 0;
      return;
    }
    // A detection that suddenly disagrees with the tracked wall is usually a
    // glitch; ignore up to three in a row before trusting it.
    if (maskIoU(s.seg, d) < 0.3 && (s.rejects ?? 0) < 3) {
      s.rejects = (s.rejects ?? 0) + 1;
      return;
    }
    if ((s.rejects ?? 0) >= 3) {
      s.seg = d;
      s.prob = d.slice();
      s.rejects = 0;
      return;
    }
    s.rejects = 0;
    const prob = s.prob, prev = s.seg;
    const state = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (prob[i] < 0) {
        // Newly visible area (camera moved): no history, trust this detection.
        prob[i] = d[i];
        state[i] = d[i] > 0.5 ? 1 : 0;
        continue;
      }
      const p = prob[i] * 0.55 + d[i] * 0.45;
      prob[i] = p;
      // Hysteresis: a pixel turns on above 0.6 and off below 0.3, so single
      // noisy detections can't make it blink.
      state[i] = prev[i] > 0.5 ? (p > 0.3 ? 1 : 0) : (p > 0.6 ? 1 : 0);
    }
    const kept = keepSeedRegions(state, w, h, s.seeds, 8);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = kept[i];
    s.seg = out;
  }

  /** Freezes the current camera frame into an editable photo, keeping painted walls. */
  capture(): boolean {
    const v = this.video;
    if (!v || !v.videoWidth) return false;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const preset = this.surfaces.map((s) => ({ shadeId: s.shadeId, finish: s.finish, seeds: s.seeds.slice() }));
    this.loadImage(c, c.width, c.height, "photo", preset);
    return true;
  }

  stopLive() {
    this.liveGen++;
    if (this.liveRaf) cancelAnimationFrame(this.liveRaf);
    this.liveRaf = 0;
    const v = this.video as (HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void }) | null;
    if (v && this.liveVfc && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.liveVfc);
    this.liveVfc = 0;
    this.video = null;
    if (this.state?.live) this.patch({ live: false });
  }

  // ---------- output & persistence ----------
  exportImage(maxWidth = 2048): Promise<Blob | null> {
    this.upload();
    return this.renderer.snapshot(maxWidth);
  }

  async thumbnail(width = 360): Promise<string> {
    const blob = await this.renderer.snapshot(width);
    if (!blob) return "";
    return await new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => res("");
      fr.readAsDataURL(blob);
    });
  }

  async serialize(): Promise<SessionSnapshot | null> {
    if (this.state.live || !this.sourceCanvas.width) return null;
    const image = await new Promise<Blob | null>((res) => this.sourceCanvas.toBlob(res, "image/jpeg", 0.9));
    if (!image) return null;
    return {
      image,
      maskW: this.maskW,
      maskH: this.maskH,
      surfaces: this.surfaces.map((s) => ({
        shadeId: s.shadeId,
        finish: s.finish,
        seeds: s.seeds.slice(),
        mask: s.mask ? Uint8Array.from(s.mask, (v) => Math.round(v * 255)) : null,
      })),
    };
  }

  async restore(snap: SessionSnapshot) {
    const bmp = await createImageBitmap(snap.image);
    this.loadImage(bmp, bmp.width, bmp.height, "project");
    bmp.close?.();
    const sameSize = snap.maskW === this.maskW && snap.maskH === this.maskH;
    this.surfaces = snap.surfaces.slice(0, MAX_SURFACES).map((p) => {
      const s = this.blankSurface(p.shadeId, p.finish, p.seeds);
      if (p.mask && sameSize) {
        s.seg = Float32Array.from(p.mask, (v) => v / 255);
        s.method = "saved";
        this.compose(s);
      } else if (s.seeds.length) this.segmentSurface(s);
      return s;
    });
    if (!this.surfaces.length) this.surfaces = [this.blankSurface(this.defaultShade())];
    this.sync({ selected: 0 });
  }

  /** Back to the empty state (no picture loaded). */
  clear() {
    this.stopLive();
    this.undoStack = [];
    this.redoStack = [];
    this.surfaces = this.surfaces.slice(0, 1).map((s) => this.blankSurface(s.shadeId, s.finish));
    if (!this.surfaces.length) this.surfaces = [this.blankSurface(this.defaultShade())];
    this.patch({ ready: false, live: false, compare: false, surfaces: this.views(), canUndo: false, canRedo: false });
  }

  dispose() {
    this.stopLive();
    this.renderer.dispose();
  }
}
