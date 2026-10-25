import type { InteractiveSegmenter } from "@mediapipe/tasks-vision";

export type AiStatus = "idle" | "loading" | "ready" | "failed" | "disabled";

/**
 * Wraps MediaPipe's Interactive Segmenter ("Magic Touch"): give it a point on
 * a wall and it returns a soft mask of that surface. Loaded lazily the first
 * time the visualizer needs it, so the app shell stays light on mobile data.
 */
export class AiSegmenter {
  status: AiStatus = "idle";
  error = "";
  private seg: InteractiveSegmenter | null = null;
  private pending: Promise<boolean> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private modelUrl: string,
    private wasmBase: string,
    enabled: boolean,
    private fallbackUrl?: string,
  ) {
    if (!enabled) this.status = "disabled";
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(status: AiStatus, error = "") {
    this.status = status;
    this.error = error;
    this.listeners.forEach((fn) => fn());
  }

  load(timeoutMs = 60000): Promise<boolean> {
    if (this.status === "disabled") return Promise.resolve(false);
    if (this.status === "ready") return Promise.resolve(true);
    if (this.pending) return this.pending;
    this.set("loading");
    const work = (async () => {
      const { FilesetResolver, InteractiveSegmenter } = await import("@mediapipe/tasks-vision");
      const base = new URL(this.wasmBase.replace(/\/$/, ""), document.baseURI).href;
      const fileset = await FilesetResolver.forVisionTasks(base);
      const make = (url: string, delegate: "GPU" | "CPU") =>
        InteractiveSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: new URL(url, document.baseURI).href, delegate },
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      let lastError: unknown = null;
      for (const url of [this.modelUrl, this.fallbackUrl].filter((u): u is string => !!u)) {
        for (const delegate of ["GPU", "CPU"] as const) {
          try {
            this.seg = await make(url, delegate);
            return true;
          } catch (e) {
            lastError = e;
          }
        }
      }
      throw lastError ?? new Error("The wall detection model couldn't be loaded.");
    })();
    const timeout = new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error("Timed out loading the wall detection model.")), timeoutMs));
    this.pending = Promise.race([work, timeout])
      .then(() => {
        this.set("ready");
        return true;
      })
      .catch((e: unknown) => {
        this.seg = null;
        this.set("failed", e instanceof Error ? e.message : String(e));
        return false;
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  get ready(): boolean {
    return this.status === "ready" && !!this.seg;
  }

  /**
   * Segments the surface under each seed and returns the union as a mask the
   * size of `source`. Returns null if the model is not ready or fails.
   */
  segment(source: HTMLCanvasElement, seeds: Array<[number, number]>, threshold = 0.5): Float32Array | null {
    if (!this.seg || !seeds.length) return null;
    const w = source.width, h = source.height;
    const out = new Float32Array(w * h);
    try {
      for (const [x, y] of seeds) {
        const kx = Math.min(0.999, Math.max(0.001, x)), ky = Math.min(0.999, Math.max(0.001, y));
        this.seg.segment(source, { keypoint: { x: kx, y: ky } }, (result) => {
          const masks = result.confidenceMasks ?? [];
          if (!masks.length) return;
          const px = Math.min(masks[0].width - 1, Math.floor(kx * masks[0].width));
          const py = Math.min(masks[0].height - 1, Math.floor(ky * masks[0].height));
          // Pick whichever output channel is "on" at the tapped point; the model's
          // channel order is not part of its contract.
          let best: Float32Array | null = null, bestV = -1;
          for (const m of masks) {
            const arr = m.getAsFloat32Array();
            const v = arr[py * m.width + px];
            if (v > bestV) { bestV = v; best = arr; }
          }
          if (!best) return;
          const invert = masks.length === 1 && bestV < 0.5;
          const mw = masks[0].width, mh = masks[0].height;
          for (let yy = 0; yy < h; yy++) {
            const sy = Math.min(mh - 1, Math.floor((yy / h) * mh));
            for (let xx = 0; xx < w; xx++) {
              const sx = Math.min(mw - 1, Math.floor((xx / w) * mw));
              let v = best[sy * mw + sx];
              if (invert) v = 1 - v;
              // Soft edge around the threshold keeps anti-aliased borders.
              const soft = Math.min(1, Math.max(0, (v - threshold) * 6 + 0.5));
              const i = yy * w + xx;
              if (soft > out[i]) out[i] = soft;
            }
          }
        });
      }
    } catch (e) {
      this.set("failed", e instanceof Error ? e.message : String(e));
      this.seg = null;
      return null;
    }
    return out;
  }
}
