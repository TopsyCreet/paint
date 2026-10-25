import * as THREE from "three";
import type { Finish } from "../data/types";
import { hexToRgb } from "./colour";

export const MAX_SURFACES = 8;

export interface SurfaceLayer {
  mask: Float32Array | null;
  hex: string;
  finish: Finish;
  /** Median linear luminance of the original surface; paint is scaled relative to it. */
  base: number;
  /** Mean chromaticity (r, g, b / sum) of the original wall, for edge refinement. */
  chroma?: [number, number, number] | null;
}

const FINISH_SHEEN: Record<Finish, number> = { matt: 0, satin: 0.06, silk: 0.1, gloss: 0.2 };

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Repaints masked pixels in linear light. The original pixel's luminance
// relative to the surface's median keeps shadows, highlights and texture.
const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uImg;
uniform sampler2D uMaskA;
uniform sampler2D uMaskB;
uniform vec3 uColor[${MAX_SURFACES}];
uniform float uBase[${MAX_SURFACES}];
uniform float uSheen[${MAX_SURFACES}];
uniform float uActive[${MAX_SURFACES}];
uniform float uCompare;
uniform float uSplit;
uniform float uLine;
uniform float uHighlight;
uniform int uSelected;
uniform mat3 uMaskXf;
uniform vec3 uChroma[${MAX_SURFACES}];
uniform float uRefine;
varying vec2 vUv;

vec3 toLin(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

vec3 paint(vec3 col, float Y, float base, float sheen) {
  float s = clamp(Y / max(base, 0.02), 0.0, 2.2);
  vec3 p = col * mix(s, pow(s, 1.12), sheen * 2.0);
  p += sheen * smoothstep(1.05, 1.7, s) * vec3(1.0);
  return p / (1.0 + max(p - 1.0, 0.0));
}

void main() {
  vec3 srgb = texture2D(uImg, vUv).rgb;
  vec3 src = toLin(srgb);
  float Y = dot(src, vec3(0.2126, 0.7152, 0.0722));
  // Mask coordinates follow the camera: uMaskXf maps this frame to the mask's frame.
  vec2 muv = (uMaskXf * vec3(vUv.x, 1.0 - vUv.y, 1.0)).xy;
  float inside = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
  vec4 ma = texture2D(uMaskA, muv) * inside;
  vec4 mb = texture2D(uMaskB, muv) * inside;
  vec3 chroma = srgb / (srgb.r + srgb.g + srgb.b + 0.0001);
  float lit = smoothstep(0.01, 0.06, Y);
  float m[${MAX_SURFACES}];
  m[0] = ma.r; m[1] = ma.g; m[2] = ma.b; m[3] = ma.a;
  m[4] = mb.r; m[5] = mb.g; m[6] = mb.b; m[7] = mb.a;
  vec3 o = src;
  float sel = 0.0;
  for (int i = 0; i < ${MAX_SURFACES}; i++) {
    float a = m[i] * uActive[i];
    // Edge refinement at full resolution: fade paint on pixels whose colour
    // differs from the wall's own colour (doors, frames, furniture at the border).
    if (uRefine > 0.0 && a > 0.0 && uChroma[i].x > 0.0) {
      float sim = 1.0 - smoothstep(0.05, 0.13, distance(chroma, uChroma[i]));
      a *= mix(1.0, mix(1.0, sim, lit), uRefine);
    }
    o = mix(o, paint(uColor[i], Y, uBase[i], uSheen[i]), a);
    if (i == uSelected) sel = a;
  }
  // Pulse outline of the selected surface while choosing a wall.
  if (uHighlight > 0.0) {
    o = mix(o, o + vec3(0.18), sel * uHighlight * 0.35);
  }
  if (uCompare > 0.5) {
    if (vUv.x < uSplit) o = src;
    if (abs(vUv.x - uSplit) < uLine) o = vec3(1.0);
  }
  gl_FragColor = vec4(toSrgb(o), 1.0);
}
`;

export class PaintRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private sourceTex: THREE.Texture | null = null;
  private maskTex: [THREE.DataTexture, THREE.DataTexture] | null = null;
  private maskData: [Uint8Array, Uint8Array] | null = null;
  private maskW = 0;
  private maskH = 0;
  private blurTmp = new Float32Array(0);
  private blurOut = new Float32Array(0);
  srcW = 1;
  srcH = 1;
  private queued = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, antialias: false, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const colors = Array.from({ length: MAX_SURFACES }, () => new THREE.Vector3(1, 1, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uImg: { value: null },
        uMaskA: { value: null },
        uMaskB: { value: null },
        uColor: { value: colors },
        uBase: { value: new Array(MAX_SURFACES).fill(0.5) },
        uSheen: { value: new Array(MAX_SURFACES).fill(0) },
        uActive: { value: new Array(MAX_SURFACES).fill(0) },
        uCompare: { value: 0 },
        uSplit: { value: 0.5 },
        uLine: { value: 0.002 },
        uHighlight: { value: 0 },
        uSelected: { value: 0 },
        uMaskXf: { value: new THREE.Matrix3() },
        uChroma: { value: Array.from({ length: MAX_SURFACES }, () => new THREE.Vector3(0, 0, 0)) },
        uRefine: { value: 0.9 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  static supported(): boolean {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  }

  setImageSource(source: HTMLCanvasElement | HTMLVideoElement) {
    if (this.sourceTex) this.sourceTex.dispose();
    const tex = source instanceof HTMLVideoElement ? new THREE.VideoTexture(source) : new THREE.CanvasTexture(source);
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.sourceTex = tex;
    this.material.uniforms.uImg.value = tex;
    if (source instanceof HTMLVideoElement) {
      this.srcW = source.videoWidth || 1280;
      this.srcH = source.videoHeight || 720;
    } else {
      this.srcW = source.width;
      this.srcH = source.height;
    }
  }

  /** Marks a canvas source as changed (after drawing new pixels into it). */
  refreshSource() {
    if (this.sourceTex) this.sourceTex.needsUpdate = true;
  }

  private ensureMaskTextures(w: number, h: number) {
    if (this.maskTex && this.maskW === w && this.maskH === h) return;
    this.maskTex?.forEach((t) => t.dispose());
    this.maskW = w;
    this.maskH = h;
    const a = new Uint8Array(w * h * 4), b = new Uint8Array(w * h * 4);
    const mk = (d: Uint8Array) => {
      const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat);
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      return t;
    };
    this.maskData = [a, b];
    this.maskTex = [mk(a), mk(b)];
    this.material.uniforms.uMaskA.value = this.maskTex[0];
    this.material.uniforms.uMaskB.value = this.maskTex[1];
    this.blurTmp = new Float32Array(w * h);
    this.blurOut = new Float32Array(w * h);
  }

  /** Uploads surface masks (feathered by a small box blur) and paint settings. */
  setSurfaces(maskW: number, maskH: number, layers: SurfaceLayer[]) {
    this.ensureMaskTextures(maskW, maskH);
    const [a, b] = this.maskData!;
    a.fill(0);
    b.fill(0);
    const u = this.material.uniforms;
    const w = maskW, h = maskH, tmp = this.blurTmp, out = this.blurOut;
    for (let s = 0; s < MAX_SURFACES; s++) {
      const layer = layers[s];
      u.uActive.value[s] = layer && layer.mask ? 1 : 0;
      if (!layer) continue;
      const [r, g, bl] = hexToRgb(layer.hex);
      (u.uColor.value[s] as THREE.Vector3).set(Math.pow(r / 255, 2.2), Math.pow(g / 255, 2.2), Math.pow(bl / 255, 2.2));
      u.uBase.value[s] = layer.base;
      u.uSheen.value[s] = FINISH_SHEEN[layer.finish] ?? 0;
      const c = layer.chroma;
      (u.uChroma.value[s] as THREE.Vector3).set(c ? c[0] : 0, c ? c[1] : 0, c ? c[2] : 0);
      if (!layer.mask || layer.mask.length !== w * h) continue;
      const m = layer.mask;
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
          const x0 = x > 0 ? x - 1 : x, x1 = x < w - 1 ? x + 1 : x;
          tmp[row + x] = (m[row + x0] + m[row + x] + m[row + x1]) / 3;
        }
      }
      for (let y = 0; y < h; y++) {
        const y0 = y > 0 ? y - 1 : y, y1 = y < h - 1 ? y + 1 : y;
        for (let x = 0; x < w; x++) out[y * w + x] = (tmp[y0 * w + x] + tmp[y * w + x] + tmp[y1 * w + x]) / 3;
      }
      const target = s < 4 ? a : b, ch = s % 4;
      for (let i = 0; i < w * h; i++) target[i * 4 + ch] = Math.round(out[i] * 255);
    }
    this.maskTex![0].needsUpdate = true;
    this.maskTex![1].needsUpdate = true;
  }

  /** Affine (normalised, y down) mapping the displayed frame to mask coordinates. */
  setMaskTransform(m: [number, number, number, number, number, number]) {
    (this.material.uniforms.uMaskXf.value as THREE.Matrix3).set(m[0], m[1], m[2], m[3], m[4], m[5], 0, 0, 1);
  }

  setRefine(amount: number) {
    this.material.uniforms.uRefine.value = amount;
  }

  setCompare(on: boolean, split: number) {
    this.material.uniforms.uCompare.value = on ? 1 : 0;
    this.material.uniforms.uSplit.value = split;
  }

  setHighlight(selected: number, amount: number) {
    this.material.uniforms.uSelected.value = selected;
    this.material.uniforms.uHighlight.value = amount;
  }

  /** Sizes the drawing buffer to fit `maxW`×`maxH` CSS pixels at the source aspect. */
  fit(maxW: number, maxH: number): { width: number; height: number } {
    let w = maxW, h = (w * this.srcH) / this.srcW;
    if (h > maxH) {
      h = maxH;
      w = (h * this.srcW) / this.srcH;
    }
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    this.renderer.setSize(w, h);
    this.material.uniforms.uLine.value = 1.2 / w;
    return { width: w, height: h };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  requestRender() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.render();
    });
  }

  /** Renders at up to `maxWidth` pixels wide and returns a PNG, without the compare split. */
  async snapshot(maxWidth = 2048): Promise<Blob | null> {
    const u = this.material.uniforms;
    const prevCompare = u.uCompare.value, prevHi = u.uHighlight.value;
    const pr = this.renderer.getPixelRatio();
    const cssW = this.canvas.clientWidth, cssH = this.canvas.clientHeight;
    const outW = Math.min(maxWidth, this.srcW), outH = Math.round((outW * this.srcH) / this.srcW);
    u.uCompare.value = 0;
    u.uHighlight.value = 0;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(outW, outH, false);
    this.render();
    const blob = await new Promise<Blob | null>((res) => this.canvas.toBlob(res, "image/png"));
    u.uCompare.value = prevCompare;
    u.uHighlight.value = prevHi;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(cssW, cssH);
    this.render();
    return blob;
  }

  dispose() {
    this.sourceTex?.dispose();
    this.maskTex?.forEach((t) => t.dispose());
    this.material.dispose();
    this.renderer.dispose();
  }
}
