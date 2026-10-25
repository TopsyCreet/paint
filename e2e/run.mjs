// End-to-end smoke test in real Chromium, including the live camera fed from a
// fake video device. Usage: npm run build && npm run e2e
// Requires Playwright with Chromium (npx playwright install chromium) and ffmpeg
// for the fake camera clip (the camera scenario is skipped without ffmpeg).
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}e2e/out`;
mkdirSync(out, { recursive: true });
const PORT = 4179;
const BASE = `http://127.0.0.1:${PORT}/`;
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

const server = spawn(process.execPath, [`${root}node_modules/vite/bin/vite.js`, "preview", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: root, stdio: "pipe" });
server.stderr.on("data", (d) => process.stderr.write(d));
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("preview server did not start")), 20000);
  server.stdout.on("data", (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); resolve(); } });
});

const consoleErrors = [];
function watch(page, label) {
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${label}: ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`${label}: ${e.message}`));
}

async function surfaceText(page) {
  return page.locator(".surface-chip").first().innerText();
}

try {
  // ---------- Desktop ----------
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  watch(desk, "desktop");
  await desk.goto(BASE);
  await desk.waitForSelector(".empty-state");
  check("opens on the start screen", await desk.getByText("See your walls in a new colour").isVisible());
  check("no sample room buttons", (await desk.getByRole("button", { name: "Bedroom" }).count()) === 0);
  check("only the colours panel", (await desk.getByRole("tab", { name: "Buy" }).count()) === 0 && (await desk.getByText("Quantity").count()) === 0);
  await desk.screenshot({ path: `${out}/desktop-start.png` });

  await desk.goto(`${BASE}?demo=living`);
  await desk.waitForSelector("canvas");
  await desk.waitForTimeout(1500);
  check("demo scene pre-painted", /Okra Green/.test(await surfaceText(desk)), await surfaceText(desk));
  await desk.screenshot({ path: `${out}/desktop-living.png` });

  await desk.getByRole("button", { name: "Edge", exact: true }).click();
  await desk.getByRole("button", { name: /Add wall/ }).click();
  const box = await desk.locator("canvas").boundingBox();
  await desk.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.75); // left wall
  await desk.waitForTimeout(400);
  const chips = await desk.locator(".surface-chip").allInnerTexts();
  check("tap paints a second wall", chips.length >= 2 && !/Not painted/.test(chips[1]), chips.join(" | "));
  await desk.getByRole("button", { name: /Jollof Ember/ }).first().click();
  await desk.waitForTimeout(300);
  check("colour applies to selected wall", /Jollof Ember/.test((await desk.locator(".surface-chip").allInnerTexts())[1] ?? ""));
  await desk.getByRole("button", { name: "Undo" }).click();
  await desk.waitForTimeout(200);
  check("undo works", !/Jollof Ember/.test((await desk.locator(".surface-chip").allInnerTexts())[1] ?? ""));
  await desk.getByRole("button", { name: "Match colour" }).click();
  await desk.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.55);
  await desk.waitForTimeout(300);
  check("colour match shows results", await desk.getByText("Closest colours to what you tapped").isVisible());
  await desk.getByRole("button", { name: "Tap wall" }).click();
  await desk.getByRole("button", { name: "Before / after" }).click();
  await desk.waitForTimeout(200);
  await desk.screenshot({ path: `${out}/desktop-compare.png` });
  await desk.getByRole("button", { name: "Before / after" }).click();
  for (const id of ["bedroom", "exterior"]) {
    await desk.goto(`${BASE}?demo=${id}`);
    await desk.waitForSelector("canvas");
    await desk.waitForTimeout(800);
    check(`${id} demo paints its preset wall`, !/Not painted/.test(await surfaceText(desk)), await surfaceText(desk));
    await desk.screenshot({ path: `${out}/desktop-${id}.png` });
  }
  await desk.locator("#file-upload").setInputFiles(`${out}/desktop-living.png`);
  await desk.waitForTimeout(800);
  check("photo upload loads", await desk.getByRole("button", { name: /Upload photo/ }).getAttribute("aria-pressed") === "true");
  await desk.goto(`${BASE}admin.html`);
  await desk.waitForSelector(".table");
  check("admin loads shades", (await desk.locator(".table tbody tr").count()) > 10);
  await desk.close();

  // ---------- Mobile (dark) ----------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const mob = await mctx.newPage();
  watch(mob, "mobile");
  await mob.goto(BASE);
  await mob.waitForSelector(".empty-state");
  await mob.screenshot({ path: `${out}/mobile-start.png` });
  await mob.goto(`${BASE}?demo=living`);
  await mob.waitForSelector("canvas");
  await mob.waitForTimeout(1200);
  const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("no horizontal scroll on phone", overflow <= 0, `overflow ${overflow}px`);
  await mob.screenshot({ path: `${out}/mobile-paint.png` });
  await mob.locator(".rail button").nth(3).click();
  await mob.waitForTimeout(300);
  check("phone: rail colour applies", !/Okra Green/.test(await surfaceText(mob)), await surfaceText(mob));
  await mctx.close();
  await browser.close();

  // ---------- Live camera (fake device fed with a panning room clip) ----------
  const ff = spawnSync("ffmpeg", ["-version"]);
  if (ff.status === 0) {
    const clip = `${out}/room.y4m`;
    if (!existsSync(clip)) {
      spawnSync("ffmpeg", ["-y", "-loop", "1", "-i", `${out}/desktop-bedroom.png`, "-vf", "crop=iw*0.62:ih*0.8:x='(iw*0.38)*(0.5+0.5*sin(t*0.6))':y=ih*0.06,scale=1280:720,format=yuv420p", "-t", "6", "-r", "15", clip], { stdio: "ignore" });
    }
    const cam = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${clip}`] });
    const cctx = await cam.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["camera"] });
    const cp = await cctx.newPage();
    watch(cp, "camera");
    await cp.goto(BASE);
    await cp.waitForSelector(".empty-state");
    await cp.getByRole("button", { name: /Live camera/ }).first().click();
    await cp.waitForSelector(".live-bar", { timeout: 15000 });
    await cp.getByRole("button", { name: "Edge", exact: true }).click();
    check("live camera starts", true);
    await cp.getByRole("button", { name: "Paint here" }).click();
    await cp.waitForTimeout(2500);
    check("live paint applied", !/Not painted/.test(await surfaceText(cp)), await surfaceText(cp));
    await cp.screenshot({ path: `${out}/mobile-live.png` });
    await cp.getByRole("button", { name: "Capture" }).click();
    await cp.waitForTimeout(800);
    check("capture freezes into editable photo", await cp.getByRole("button", { name: "Brush" }).isEnabled());
    await cp.screenshot({ path: `${out}/mobile-captured.png` });
    await cam.close();

    // Permission refused → clear guidance instead of a dead end.
    const deny = await chromium.launch();
    const dctx = await deny.newContext({ viewport: { width: 390, height: 844 } });
    // Simulate the user tapping "Block" on the permission prompt.
    await dctx.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError")); });
    const dp = await dctx.newPage();
    await dp.goto(BASE);
    await dp.waitForSelector(".empty-state");
    await dp.getByRole("button", { name: /Live camera/ }).first().click();
    await dp.waitForSelector("[role=alert]", { timeout: 10000 });
    const t = await dp.locator("[role=alert] h3").innerText();
    check("denied camera explains how to allow it", /permission/i.test(t), t);
    await dp.screenshot({ path: `${out}/mobile-camera-denied.png` });
    await deny.close();
  } else {
    console.log("SKIP  live camera (ffmpeg not found)");
  }
} catch (e) {
  check("run completed", false, String(e && e.stack || e));
} finally {
  server.kill();
}

const failed = results.filter((r) => !r.ok);
const errs = consoleErrors.filter((e) => !/storage\.googleapis|Failed to load resource|tile\.openstreetmap|fonts\.g|wasm|vision_wasm|smart detection/i.test(e));
writeFileSync(`${out}/report.json`, JSON.stringify({ results, consoleErrors }, null, 2));
if (errs.length) console.log("Console errors:\n" + errs.join("\n"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
