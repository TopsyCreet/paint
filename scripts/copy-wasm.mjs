// Copies the MediaPipe vision WASM runtime into public/ so the app can serve it
// from its own origin (no third-party CDN needed at runtime). Runs on install.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = `${root}node_modules/@mediapipe/tasks-vision/wasm`;
const dest = `${root}public/vendor/mediapipe/wasm`;

if (!existsSync(src)) {
  console.warn("[copy-wasm] @mediapipe/tasks-vision not installed; skipping.");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const f of [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]) {
  cpSync(`${src}/${f}`, `${dest}/${f}`);
}
console.log("[copy-wasm] MediaPipe WASM copied to public/vendor/mediapipe/wasm");
