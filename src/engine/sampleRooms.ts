import type { PresetSurface } from "./session";

/**
 * Built-in sample scenes, drawn in code so the app ships without stock photos.
 * Replace or extend with real photos via public/data/brand.json → see docs/DATA.md.
 */
export interface SampleRoom {
  id: string;
  name: string;
  draw: () => HTMLCanvasElement;
  preset: PresetSurface[];
}

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

function poly(g: Ctx, pts: Pt[], fill: string | CanvasGradient) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}
function rr(g: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
  g.fillStyle = fill;
  g.fill();
}
function line(g: Ctx, a: Pt, b: Pt, w: number, colour: string) {
  g.strokeStyle = colour;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.stroke();
}
function grain(g: Ctx, w: number, h: number, amount = 5, seed = 7) {
  const id = g.getImageData(0, 0, w, h), d = id.data;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(id, 0, 0);
}
function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}
function plant(g: Ctx, x: number, baseY: number, scale = 1, pot = "#B0613C") {
  const leaves: Array<[number, number, number, number, number]> = [
    [-30, -180, 60, 22, -0.9], [15, -200, 64, 22, -0.4], [-60, -230, 58, 20, -1.3], [40, -140, 55, 20, 0.2],
    [-10, -260, 60, 20, -0.7], [60, -230, 58, 20, -0.1], [-50, -120, 50, 18, -1.6],
  ];
  line(g, [x, baseY - 10 * scale], [x - 10 * scale, baseY - 230 * scale], 6 * scale, "#3A4F30");
  leaves.forEach((l, i) => {
    g.fillStyle = i % 2 ? "#3E5A36" : "#56744A";
    g.beginPath();
    g.ellipse(x + l[0] * scale, baseY + l[1] * scale, l[2] * scale, l[3] * scale, l[4], 0, Math.PI * 2);
    g.fill();
  });
  poly(g, [[x - 50 * scale, baseY - 110 * scale], [x + 52 * scale, baseY - 110 * scale], [x + 38 * scale, baseY], [x - 36 * scale, baseY]], pot);
}

/** `wall` overrides the back-wall colour (used to make ground-truth masks in tests). */
export function livingRoom(wall = "#E8E2D8"): HTMLCanvasElement {
  const W = 1600, H = 1080, BX0 = 380, BX1 = 1220, BY0 = 120, BY1 = 760;
  const [c, g] = canvas(W, H);
  let gr = g.createLinearGradient(0, 0, 0, BY0);
  gr.addColorStop(0, "#EDEBE6"); gr.addColorStop(1, "#F6F4EF");
  poly(g, [[0, 0], [W, 0], [BX1, BY0], [BX0, BY0]], gr);
  poly(g, [[BX0, BY0], [BX1, BY0], [BX1, BY1], [BX0, BY1]], wall);
  gr = g.createLinearGradient(BX0, 0, BX1, 0);
  gr.addColorStop(0, "rgba(255,250,240,0.22)"); gr.addColorStop(0.55, "rgba(255,250,240,0)"); gr.addColorStop(1, "rgba(30,20,10,0.12)");
  poly(g, [[BX0, BY0], [BX1, BY0], [BX1, BY1], [BX0, BY1]], gr);
  poly(g, [[0, 0], [BX0, BY0], [BX0, BY1], [0, H]], "#EEE9E0");
  gr = g.createLinearGradient(0, 0, BX0, 0);
  gr.addColorStop(0, "rgba(255,252,245,0.18)"); gr.addColorStop(1, "rgba(30,20,10,0.05)");
  poly(g, [[0, 0], [BX0, BY0], [BX0, BY1], [0, H]], gr);
  poly(g, [[W, 0], [BX1, BY0], [BX1, BY1], [W, H]], "#D9D2C6");
  gr = g.createLinearGradient(BX1, 0, W, 0);
  gr.addColorStop(0, "rgba(20,15,10,0.04)"); gr.addColorStop(1, "rgba(20,15,10,0.16)");
  poly(g, [[W, 0], [BX1, BY0], [BX1, BY1], [W, H]], gr);
  // floor
  poly(g, [[0, H], [BX0, BY1], [BX1, BY1], [W, H]], "#8C6B4C");
  g.save();
  g.beginPath(); g.moveTo(0, H); g.lineTo(BX0, BY1); g.lineTo(BX1, BY1); g.lineTo(W, H); g.closePath(); g.clip();
  for (let i = 0; i <= 18; i++) { const t = i / 18; line(g, [t * W, H], [BX0 + t * (BX1 - BX0), BY1], 2, "rgba(40,25,12,0.28)"); }
  for (let j = 1; j < 7; j++) { const y = BY1 + (H - BY1) * Math.pow(j / 7, 1.6); line(g, [0, y], [W, y], 2, "rgba(40,25,12,0.1)"); }
  gr = g.createRadialGradient(260, 980, 40, 260, 980, 900);
  gr.addColorStop(0, "rgba(255,235,200,0.22)"); gr.addColorStop(1, "rgba(0,0,0,0.18)");
  g.fillStyle = gr; g.fillRect(0, BY1, W, H - BY1);
  g.restore();
  // window (left wall)
  const lw = (u: number, v: number): Pt => { const x = u * BX0; const top = (x / BX0) * BY0, bot = H - (x / BX0) * (H - BY1); return [x, top + v * (bot - top)]; };
  const win = [lw(0.25, 0.2), lw(0.8, 0.22), lw(0.8, 0.6), lw(0.25, 0.64)];
  gr = g.createLinearGradient(0, win[0][1], 0, win[3][1]);
  gr.addColorStop(0, "#9CC6E4"); gr.addColorStop(1, "#D3E7F2");
  poly(g, win, gr);
  for (const [w, col] of [[18, "rgba(40,30,20,0.35)"], [12, "#FFFFFF"]] as Array<[number, string]>) {
    g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(win[0][0], win[0][1]); win.forEach((p) => g.lineTo(p[0], p[1])); g.closePath(); g.stroke();
  }
  line(g, lw(0.525, 0.21), lw(0.525, 0.62), 8, "#FFFFFF");
  // door (right wall)
  const rw = (u: number, v: number): Pt => { const x = W - u * (W - BX1); const k = (W - x) / (W - BX1); const top = k * BY0, bot = H - k * (H - BY1); return [x, top + v * (bot - top)]; };
  poly(g, [rw(0.62, 0.3), rw(0.28, 0.27), rw(0.28, 1), rw(0.62, 1)], "#6E4A2E");
  const dp = [rw(0.57, 0.36), rw(0.33, 0.34), rw(0.33, 0.6), rw(0.57, 0.62)];
  g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 3; g.beginPath(); g.moveTo(dp[0][0], dp[0][1]); dp.forEach((p) => g.lineTo(p[0], p[1])); g.closePath(); g.stroke();
  const kn = rw(0.36, 0.68); g.fillStyle = "#D8B66A"; g.beginPath(); g.arc(kn[0], kn[1], 7, 0, Math.PI * 2); g.fill();
  // skirting
  poly(g, [[BX0, BY1 - 24], [BX1, BY1 - 24], [BX1, BY1], [BX0, BY1]], "#F5F2EC");
  poly(g, [[0, H - 40], [BX0, BY1 - 22], [BX0, BY1], [0, H]], "#F7F4EE");
  poly(g, [[W, H - 40], [BX1, BY1 - 22], [BX1, BY1], [W, H]], "#E6E1D8");
  g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(BX0, BY1 - 26, BX1 - BX0, 2);
  line(g, [BX0, BY0], [BX0, BY1], 5, "rgba(25,18,10,0.22)");
  line(g, [BX1, BY0], [BX1, BY1], 5, "rgba(25,18,10,0.3)");
  line(g, [BX0, BY0], [BX1, BY0], 4, "rgba(25,18,10,0.18)");
  line(g, [0, 0], [BX0, BY0], 4, "rgba(25,18,10,0.14)");
  line(g, [W, 0], [BX1, BY0], 4, "rgba(25,18,10,0.18)");
  // rug
  g.fillStyle = "rgba(185,143,106,0.85)"; g.beginPath(); g.ellipse(800, 935, 520, 105, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(120,80,50,0.5)"; g.lineWidth = 6; g.beginPath(); g.ellipse(800, 935, 470, 88, 0, 0, Math.PI * 2); g.stroke();
  // art
  g.fillStyle = "#2A2A2E"; g.fillRect(688, 228, 224, 214);
  g.fillStyle = "#F4F1EA"; g.fillRect(700, 240, 200, 190);
  g.fillStyle = "#C8452C"; g.beginPath(); g.arc(770, 320, 42, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#2F3E66"; g.fillRect(800, 300, 70, 100);
  g.fillStyle = "#D9A02E"; g.beginPath(); g.arc(835, 290, 22, 0, Math.PI * 2); g.fill();
  // sofa
  g.fillStyle = "rgba(0,0,0,0.22)"; g.beginPath(); g.ellipse(800, 842, 290, 26, 0, 0, Math.PI * 2); g.fill();
  rr(g, 570, 540, 460, 170, 26, "#3E4A56");
  rr(g, 560, 680, 480, 135, 22, "#46525F");
  rr(g, 535, 600, 70, 220, 22, "#38434E"); rr(g, 995, 600, 70, 220, 22, "#38434E");
  rr(g, 600, 625, 190, 70, 16, "#525F6D"); rr(g, 810, 625, 190, 70, 16, "#525F6D");
  rr(g, 615, 575, 120, 95, 18, "#C8452C"); rr(g, 865, 575, 120, 95, 18, "#D9A02E");
  g.fillStyle = "#2A221B"; g.fillRect(575, 815, 14, 24); g.fillRect(1011, 815, 14, 24);
  plant(g, 1210, 800);
  grain(g, W, H);
  return c;
}

function bedroom(): HTMLCanvasElement {
  const W = 1600, H = 1080, BX0 = 300, BX1 = 1300, BY0 = 90, BY1 = 780;
  const [c, g] = canvas(W, H);
  poly(g, [[0, 0], [W, 0], [BX1, BY0], [BX0, BY0]], "#F3F1EC");
  poly(g, [[BX0, BY0], [BX1, BY0], [BX1, BY1], [BX0, BY1]], "#E4DED3");
  let gr = g.createRadialGradient(800, 300, 50, 800, 400, 700);
  gr.addColorStop(0, "rgba(255,248,232,0.25)"); gr.addColorStop(1, "rgba(30,20,10,0.10)");
  poly(g, [[BX0, BY0], [BX1, BY0], [BX1, BY1], [BX0, BY1]], gr);
  poly(g, [[0, 0], [BX0, BY0], [BX0, BY1], [0, H]], "#DCD5C9");
  poly(g, [[W, 0], [BX1, BY0], [BX1, BY1], [W, H]], "#EAE5DC");
  gr = g.createLinearGradient(BX1, 0, W, 0);
  gr.addColorStop(0, "rgba(255,250,240,0.0)"); gr.addColorStop(1, "rgba(255,250,240,0.2)");
  poly(g, [[W, 0], [BX1, BY0], [BX1, BY1], [W, H]], gr);
  // floor tiles
  poly(g, [[0, H], [BX0, BY1], [BX1, BY1], [W, H]], "#CFC6B8");
  g.save(); g.beginPath(); g.moveTo(0, H); g.lineTo(BX0, BY1); g.lineTo(BX1, BY1); g.lineTo(W, H); g.closePath(); g.clip();
  for (let i = 0; i <= 10; i++) { const t = i / 10; line(g, [t * W, H], [BX0 + t * (BX1 - BX0), BY1], 2, "rgba(90,80,70,0.25)"); }
  for (let j = 1; j < 6; j++) { const y = BY1 + (H - BY1) * Math.pow(j / 6, 1.5); line(g, [0, y], [W, y], 2, "rgba(90,80,70,0.25)"); }
  g.restore();
  // right-wall window with curtains
  const rw = (u: number, v: number): Pt => { const x = W - u * (W - BX1); const k = (W - x) / (W - BX1); const top = k * BY0, bot = H - k * (H - BY1); return [x, top + v * (bot - top)]; };
  const win = [rw(0.72, 0.2), rw(0.3, 0.17), rw(0.3, 0.6), rw(0.72, 0.62)];
  gr = g.createLinearGradient(0, win[0][1], 0, win[3][1]);
  gr.addColorStop(0, "#A9CDE6"); gr.addColorStop(1, "#E3EFF5");
  poly(g, win, gr);
  g.strokeStyle = "#FFFFFF"; g.lineWidth = 12; g.beginPath(); g.moveTo(win[0][0], win[0][1]); win.forEach((p) => g.lineTo(p[0], p[1])); g.closePath(); g.stroke();
  poly(g, [rw(0.8, 0.14), rw(0.66, 0.15), rw(0.66, 0.75), rw(0.8, 0.77)], "#7A4E7E");
  poly(g, [rw(0.36, 0.12), rw(0.22, 0.11), rw(0.22, 0.73), rw(0.36, 0.74)], "#7A4E7E");
  // left wall wardrobe
  const lw = (u: number, v: number): Pt => { const x = u * BX0; const top = (x / BX0) * BY0, bot = H - (x / BX0) * (H - BY1); return [x, top + v * (bot - top)]; };
  poly(g, [lw(0.15, 0.12), lw(0.85, 0.16), lw(0.85, 0.98), lw(0.15, 0.97)], "#8A6A4E");
  line(g, lw(0.5, 0.14), lw(0.5, 0.97), 3, "rgba(0,0,0,0.3)");
  // skirting
  poly(g, [[BX0, BY1 - 22], [BX1, BY1 - 22], [BX1, BY1], [BX0, BY1]], "#F7F5F0");
  line(g, [BX0, BY0], [BX0, BY1], 5, "rgba(25,18,10,0.25)");
  line(g, [BX1, BY0], [BX1, BY1], 5, "rgba(25,18,10,0.18)");
  line(g, [BX0, BY0], [BX1, BY0], 4, "rgba(25,18,10,0.15)");
  // headboard + bed
  rr(g, 520, 360, 560, 300, 30, "#5B4A3E");
  rr(g, 540, 380, 520, 260, 22, "#6B594C");
  g.fillStyle = "rgba(0,0,0,0.2)"; g.beginPath(); g.ellipse(800, 935, 380, 30, 0, 0, Math.PI * 2); g.fill();
  poly(g, [[470, 640], [1130, 640], [1210, 930], [390, 930]], "#F4F1EA");
  poly(g, [[430, 770], [1170, 770], [1210, 930], [390, 930]], "#2F3E66");
  poly(g, [[390, 930], [1210, 930], [1210, 960], [390, 960]], "#5B4A3E");
  rr(g, 560, 590, 200, 90, 26, "#FFFFFF"); rr(g, 840, 590, 200, 90, 26, "#FFFFFF");
  rr(g, 690, 620, 220, 80, 24, "#D9A02E");
  // bedside tables and lamps
  for (const x of [400, 1100]) {
    rr(g, x, 640, 120, 150, 8, "#8A6A4E");
    line(g, [x + 10, 700], [x + 110, 700], 3, "rgba(0,0,0,0.25)");
    rr(g, x + 50, 560, 20, 80, 4, "#3A3A3C");
    poly(g, [[x + 20, 490], [x + 100, 490], [x + 115, 565], [x + 5, 565]], "#F1E3B8");
    gr = g.createRadialGradient(x + 60, 520, 10, x + 60, 520, 190);
    gr.addColorStop(0, "rgba(255,230,170,0.35)"); gr.addColorStop(1, "rgba(255,230,170,0)");
    g.fillStyle = gr; g.fillRect(x - 140, 330, 340, 380);
  }
  // framed prints
  for (const [x, col] of [[600, "#8E9B6E"], [840, "#C8452C"]] as Array<[number, string]>) {
    g.fillStyle = "#2A2A2E"; g.fillRect(x, 170, 160, 130);
    g.fillStyle = "#F4F1EA"; g.fillRect(x + 10, 180, 140, 110);
    g.fillStyle = col; g.beginPath(); g.arc(x + 80, 235, 32, 0, Math.PI * 2); g.fill();
  }
  grain(g, W, H, 5, 11);
  return c;
}

function exterior(): HTMLCanvasElement {
  const W = 1600, H = 1080;
  const [c, g] = canvas(W, H);
  let gr = g.createLinearGradient(0, 0, 0, 820);
  gr.addColorStop(0, "#6FA6D6"); gr.addColorStop(0.75, "#D3E6F2"); gr.addColorStop(1, "#E4EEF3");
  g.fillStyle = gr; g.fillRect(0, 0, W, 820);
  // distant tree line behind the compound wall
  g.fillStyle = "#6E8F5E";
  for (let x = -40; x < W + 80; x += 70) { g.beginPath(); g.arc(x, 770 - ((x * 37) % 40), 60, 0, Math.PI * 2); g.fill(); }
  // clouds
  g.fillStyle = "rgba(255,255,255,0.85)";
  for (const [x, y, s] of [[260, 120, 1], [1250, 90, 1.3], [820, 60, 0.8]] as Array<[number, number, number]>) {
    for (const [dx, dy, r] of [[0, 0, 40], [40, -18, 50], [90, 0, 42], [45, 12, 46]]) { g.beginPath(); g.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2); g.fill(); }
  }
  // ground
  g.fillStyle = "#A99A86"; g.fillRect(0, 820, W, H - 820);
  for (let y = 830; y < H; y += 26) for (let x = ((y / 26) % 2) * 22; x < W; x += 44) { rr(g, x, y, 40, 22, 4, (x + y) % 3 ? "#B5A792" : "#9E8F7B"); }
  // side wall (in shade)
  poly(g, [[1180, 360], [1430, 300], [1430, 800], [1180, 820]], "#D9CDB7");
  gr = g.createLinearGradient(1180, 0, 1430, 0);
  gr.addColorStop(0, "rgba(20,15,10,0.12)"); gr.addColorStop(1, "rgba(20,15,10,0.22)");
  poly(g, [[1180, 360], [1430, 300], [1430, 800], [1180, 820]], gr);
  // front facade
  poly(g, [[220, 360], [1180, 360], [1180, 820], [220, 820]], "#EADFC9");
  gr = g.createLinearGradient(220, 0, 1180, 0);
  gr.addColorStop(0, "rgba(255,250,235,0.18)"); gr.addColorStop(1, "rgba(30,20,10,0.06)");
  poly(g, [[220, 360], [1180, 360], [1180, 820], [220, 820]], gr);
  // roof
  poly(g, [[160, 370], [700, 150], [1240, 370]], "#5A3E33");
  poly(g, [[700, 150], [1240, 370], [1470, 310], [960, 110]], "#4A332A");
  for (let i = 0; i < 9; i++) { const t = i / 9; line(g, [160 + t * 540, 370 - t * 220], [700 + t * 540, 150 + t * 220], 2, "rgba(0,0,0,0.12)"); }
  poly(g, [[200, 360], [1200, 360], [1200, 384], [200, 384]], "rgba(0,0,0,0.18)");
  // windows with burglar-proof bars
  for (const x of [300, 870]) {
    g.fillStyle = "#5A4535"; g.fillRect(x - 12, 448, 254, 204);
    gr = g.createLinearGradient(0, 460, 0, 640);
    gr.addColorStop(0, "#8FB7D4"); gr.addColorStop(1, "#C6DCE9");
    g.fillStyle = gr; g.fillRect(x, 460, 230, 180);
    for (let k = 1; k < 6; k++) line(g, [x + (k * 230) / 6, 460], [x + (k * 230) / 6, 640], 4, "#2E2E30");
    line(g, [x, 550], [x + 230, 550], 4, "#2E2E30");
    g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(x - 16, 652, 262, 10);
  }
  // door
  g.fillStyle = "#4A332A"; g.fillRect(612, 470, 176, 350);
  g.fillStyle = "#6B4A33"; g.fillRect(626, 484, 148, 336);
  line(g, [700, 484], [700, 820], 3, "rgba(0,0,0,0.3)");
  g.fillStyle = "#D8B66A"; g.beginPath(); g.arc(752, 660, 7, 0, Math.PI * 2); g.fill();
  // step
  poly(g, [[580, 820], [820, 820], [840, 846], [560, 846]], "#C2B6A2");
  // fence wall in front
  poly(g, [[0, 760], [180, 760], [180, 900], [0, 900]], "#D6C7AE");
  poly(g, [[1460, 760], [W, 760], [W, 900], [1460, 900]], "#D6C7AE");
  for (const x0 of [0, 1460]) { poly(g, [[x0, 748], [x0 + (x0 ? 140 : 180), 748], [x0 + (x0 ? 140 : 180), 762], [x0, 762]], "#B9AA92"); }
  // palm
  line(g, [1520, 760], [1490, 380], 14, "#7A5A3A");
  for (let a = 0; a < 8; a++) {
    const ang = -Math.PI / 2 + (a - 3.5) * 0.42;
    g.strokeStyle = a % 2 ? "#3E6A3A" : "#4F7D45"; g.lineWidth = 16;
    g.beginPath(); g.moveTo(1490, 380); g.quadraticCurveTo(1490 + Math.cos(ang) * 120, 380 + Math.sin(ang) * 120 - 30, 1490 + Math.cos(ang) * 210, 380 + Math.sin(ang) * 210 + 40); g.stroke();
  }
  // shadow line under roof and on ground
  g.fillStyle = "rgba(0,0,0,0.16)"; poly(g, [[220, 820], [1430, 800], [1500, 850], [260, 860]], "rgba(0,0,0,0.12)");
  grain(g, W, H, 6, 23);
  return c;
}

export const SAMPLE_ROOMS: SampleRoom[] = [
  { id: "living", name: "Living room", draw: () => livingRoom(), preset: [{ shadeId: "okra-green", seeds: [[0.34, 0.26], [0.7, 0.2]] }] },
  { id: "bedroom", name: "Bedroom", draw: bedroom, preset: [{ shadeId: "lavender-gele", seeds: [[0.25, 0.4], [0.75, 0.2]] }] },
  { id: "exterior", name: "House front", draw: exterior, preset: [{ shadeId: "lekki-sand", seeds: [[0.2, 0.72], [0.53, 0.38], [0.66, 0.72]] }] },
];
