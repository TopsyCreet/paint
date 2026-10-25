import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useSessionState, useStore } from "../../app/store";
import { AiSegmenter } from "../../engine/aiSegmenter";
import { nearestColours } from "../../engine/colour";
import { PaintRenderer, MAX_SURFACES } from "../../engine/renderer";
import { SAMPLE_ROOMS } from "../../engine/sampleRooms";
import { PaintSession, type Tool } from "../../engine/session";
import { track } from "../../lib/analytics";
import { CameraError, cameraHelp, inAppBrowser, openRearCamera, playStream, stopStream, type CameraProblem } from "../../lib/camera";
import { shareImage } from "../../lib/share";
import { Icon } from "../../ui/icons";
import { useToast } from "../../ui/toast";
import type { Finish } from "../../data/types";
import { runBench } from "../bench/runBench";

const FINISHES: Array<{ id: Finish; label: string }> = [
  { id: "matt", label: "Matt" },
  { id: "satin", label: "Satin" },
  { id: "silk", label: "Silk" },
  { id: "gloss", label: "Gloss" },
];

type Source = "none" | "demo" | "photo" | "live";

function loadFileImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file couldn't be opened as a photo. Try a JPG or PNG.")); };
    img.src = url;
  });
}

export function Visualizer() {
  const { cat, shade, setSession, session, recent, setMatch, isWide } = useStore();
  const toast = useToast();
  const st = useSessionState(session);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [source, setSource] = useState<Source>("none");
  const [glError, setGlError] = useState(false);
  const [camProblem, setCamProblem] = useState<CameraProblem | null>(null);
  const [starting, setStarting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ mode: "stroke" | "split"; last?: [number, number] } | null>(null);
  const firstShade = cat.shades[0]?.id ?? "";

  const recentRef = useRef(recent);
  recentRef.current = recent;
  const shadeRef = useRef(shade);
  shadeRef.current = shade;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // ---------- engine setup ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!PaintRenderer.supported()) { setGlError(true); return; }
    const seg = cat.brand.segmentation;
    const ai = new AiSegmenter(seg.modelUrl, seg.wasmBase, seg.enabled, seg.modelFallbackUrl);
    let s: PaintSession;
    try {
      s = new PaintSession(canvas, ai, () => recentRef.current[0] ?? firstShade);
    } catch {
      setGlError(true);
      return;
    }
    s.hexFor = (id) => shadeRef.current(id)?.hex ?? "#CCCCCC";
    s.onNotice = (m) => toastRef.current(m);
    setSession(s);
    // Start loading the AI model early so it is ready by the first tap.
    if (seg.enabled) void ai.load();
    const params = new URLSearchParams(location.search);
    const bench = params.get("bench");
    if (bench === "ai" || bench === "classic") {
      setTimeout(() => { if (videoRef.current) void runBench(s, videoRef.current, bench, params.get("stable") !== "0", "hibiscus-pink"); }, 300);
    }
    // Hidden demo scenes for pitches and automated tests: ?demo=living|bedroom|exterior
    const demo = params.get("demo");
    const room = demo ? SAMPLE_ROOMS.find((r) => r.id === demo) ?? SAMPLE_ROOMS[0] : null;
    if (room) {
      const c = room.draw();
      s.loadImage(c, c.width, c.height, "room", room.preset.filter((p) => shadeRef.current(p.shadeId)));
      setSource("demo");
    }
    return () => {
      stopStream(streamRef.current);
      s.dispose();
      setSession(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- sizing ----------
  const fit = useCallback(() => {
    const v = viewRef.current;
    if (!session || !v || !v.clientWidth) return;
    const maxH = Math.min(window.innerHeight * (isWide ? 0.72 : 0.62), 820);
    session.renderer.fit(v.clientWidth, maxH);
    session.renderer.requestRender();
  }, [session, isWide]);
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(v);
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); };
  }, [fit]);
  useEffect(() => { fit(); }, [fit, st.aspect, st.live, st.ready]);

  // ---------- sources ----------
  const stopCamera = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    session?.stopLive();
  }, [session]);

  const loadFile = async (file: File | undefined | null) => {
    if (!file || !session) return;
    if (!file.type.startsWith("image/")) { toast("Choose a photo file (JPG or PNG)."); return; }
    try {
      const img = await loadFileImage(file);
      stopCamera();
      setCamProblem(null);
      session.loadImage(img, img.naturalWidth, img.naturalHeight, "photo");
      setSource("photo");
      track("photo_loaded", { w: img.naturalWidth, h: img.naturalHeight });
    } catch (e) {
      toast(e instanceof Error ? e.message : "That photo couldn't be opened.");
    }
  };

  const startCamera = async () => {
    if (!session || starting) return;
    setStarting(true);
    setCamProblem(null);
    try {
      const stream = await openRearCamera();
      streamRef.current = stream;
      const video = videoRef.current!;
      await playStream(video, stream);
      session.startLive(video);
      setSource("live");
      track("camera_started", {});
    } catch (e) {
      stopStream(streamRef.current);
      streamRef.current = null;
      const problem = e instanceof CameraError ? e.problem : "unknown";
      setCamProblem(problem);
      track("camera_error", { problem });
    } finally {
      setStarting(false);
    }
  };

  const endCamera = () => {
    stopCamera();
    session?.clear();
    setSource("none");
  };

  // Pause the camera when the page is hidden; the user restarts it.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && streamRef.current) {
        stopCamera();
        session?.clear();
        setSource("none");
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [stopCamera, session]);

  const capture = () => {
    if (!session) return;
    if (session.capture()) {
      stopStream(streamRef.current);
      streamRef.current = null;
      setSource("photo");
      toast("Frame captured. Refine edges with the brush, then share.");
      track("camera_captured", {});
    }
  };

  // Paste a photo from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f) void loadFile(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!session || (e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) session.redo(); else session.undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); session.redo(); }
      else if (!mod && e.key === "b") session.setTool("brush");
      else if (!mod && e.key === "e") session.setTool("erase");
      else if (!mod && e.key === "t") session.setTool("tap");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);

  // ---------- pointer ----------
  const norm = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!session || !st.ready) return;
    const [x, y] = norm(e);
    if (st.compare) {
      drag.current = { mode: "split" };
      e.currentTarget.setPointerCapture(e.pointerId);
      session.setSplit(x);
      return;
    }
    if (st.tool === "match") {
      const rgb = session.sampleColour(x, y);
      if (rgb) {
        const matches = nearestColours(rgb, cat.shades, 4);
        setMatch({ rgb, matches });
        track("colour_matched", { code: matches[0]?.item.code ?? "" });
        toast(`Closest colour: ${matches[0]?.item.name}. See the matches under Colours.`);
      }
      return;
    }
    if (st.tool === "brush" || st.tool === "erase") {
      if (st.live) { toast("Capture the frame first, then use the brush."); return; }
      drag.current = { mode: "stroke", last: [x, y] };
      e.currentTarget.setPointerCapture(e.pointerId);
      session.beginStroke();
      session.strokeTo(x, y);
      return;
    }
    const wasPainted = st.surfaces[st.selected]?.painted;
    session.tap(x, y);
    if (!wasPainted) track("surface_painted", { method: st.detector, source: st.sourceKind });
  };

  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    if (st.tool === "brush" || st.tool === "erase") setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    const d = drag.current;
    if (!d || !session) return;
    const [x, y] = norm(e);
    if (d.mode === "split") session.setSplit(x);
    else {
      session.strokeTo(x, y, d.last?.[0], d.last?.[1]);
      d.last = [x, y];
    }
  };

  const onPointerUp = () => {
    if (drag.current?.mode === "stroke") session?.endStroke();
    drag.current = null;
  };

  // ---------- actions ----------
  const shareResult = async () => {
    if (!session) return;
    const blob = await session.exportImage();
    if (!blob) { toast("The image couldn't be created. Try again."); return; }
    const names = st.surfaces.filter((s) => s.painted).map((s) => shade(s.shadeId)?.name).filter(Boolean);
    const text = names.length ? `My walls in ${names.join(", ")}, made with ${cat.brand.name}` : `Made with ${cat.brand.name}`;
    const res = await shareImage(blob, `${cat.brand.shortName.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.png`, text);
    if (res === "shared") { toast("Shared."); track("image_shared", {}); }
    else if (res === "saved") { toast("Image saved to your downloads."); track("image_saved", {}); }
  };

  const selected = st.surfaces[st.selected];
  const selectedShade = selected ? shade(selected.shadeId) : undefined;

  const hint = (() => {
    if (!st.ready) return "";
    if (st.compare) return "Drag across the picture to compare before and after.";
    if (st.live) return "";
    if (st.tool === "match") return "Tap anything in the photo to find the closest colour.";
    if (st.tool === "brush") return "Paint over areas the detection missed.";
    if (st.tool === "erase") return "Wipe paint off areas that shouldn't be painted.";
    if (!selected?.painted) return `Tap a wall to paint it ${selectedShade ? selectedShade.name : ""}.`;
    return "Tap more of the wall to extend it, or choose a colour.";
  })();

  const aiLabel = st.detector === "classic" ? "Edge detection" : st.ai === "ready" ? "Smart detection" : st.ai === "loading" ? "Loading smart detection" : st.ai === "failed" ? "Edge detection" : "Smart detection";
  const aiDot = st.detector === "ai" && st.ai === "ready" ? "ready" : st.ai === "loading" && st.detector === "ai" ? "loading" : "";
  const help = camProblem ? cameraHelp(camProblem, inAppBrowser()) : null;

  if (glError) {
    return (
      <section className="stage" aria-label="Room preview">
        <div className="viewport" style={{ minHeight: 300 }}>
          <div className="stage-msg"><div className="card">
            <h3>This browser can't show the paint preview</h3>
            <p>The preview needs WebGL. Open the app in a recent Chrome, Safari, Edge or Samsung Internet, or turn on hardware acceleration in your browser settings.</p>
          </div></div>
        </div>
      </section>
    );
  }

  const tools: Array<{ id: Tool; label: string; icon: "tap" | "brush" | "eraser" | "drop" }> = [
    { id: "tap", label: "Tap wall", icon: "tap" },
    { id: "brush", label: "Brush", icon: "brush" },
    { id: "erase", label: "Erase", icon: "eraser" },
    { id: "match", label: "Match colour", icon: "drop" },
  ];

  const empty = !st.ready && !starting && !help;

  return (
    <section className="stage" aria-label="Room preview">
      {st.ready && (
        <div className="sources" role="group" aria-label="Choose a picture">
          <button type="button" className="pill" aria-pressed={source === "live"} onClick={() => (st.live ? capture() : void startCamera())} disabled={starting}>
            <span className="rec" />Live camera
          </button>
          <button type="button" className="pill" onClick={() => captureRef.current?.click()}>
            <Icon name="camera" />Take photo
          </button>
          <button type="button" className="pill" aria-pressed={source === "photo"} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />Upload photo
          </button>
        </div>
      )}
      <input ref={fileRef} id="file-upload" className="sr" type="file" accept="image/*" onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={captureRef} id="file-capture" className="sr" type="file" accept="image/*" capture="environment" onChange={(e) => { void loadFile(e.target.files?.[0]); e.target.value = ""; }} />

      <div
        ref={viewRef}
        className={`viewport tool-${st.tool}${st.compare ? " comparing" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); void loadFile(e.dataTransfer.files?.[0]); }}
        onPointerLeave={() => setCursor(null)}
      >
        <canvas
          ref={canvasRef}
          hidden={!st.ready}
          aria-label="Your room with painted walls"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <video ref={videoRef} className="feed" playsInline muted />
        {st.ready && !camProblem && (
          <span className="status-chip" title={st.aiError || undefined}><span className={`dot ${aiDot}`} />{aiLabel}</span>
        )}
        {st.compare && <><span className="ba-label l">Before</span><span className="ba-label r">After</span></>}
        {st.live && !camProblem && <div className="reticle" />}
        {cursor && (st.tool === "brush" || st.tool === "erase") && canvasRef.current && (
          <span
            className={`brush-cursor${st.tool === "erase" ? " erase" : ""}`}
            style={{ left: cursor.x + (canvasRef.current.offsetLeft || 0), top: cursor.y + (canvasRef.current.offsetTop || 0), width: st.brushSize * 2 * Math.max(canvasRef.current.clientWidth, canvasRef.current.clientHeight), height: st.brushSize * 2 * Math.max(canvasRef.current.clientWidth, canvasRef.current.clientHeight) }}
          />
        )}
        {hint && !camProblem && <div className="overlay-hint">{hint}</div>}
        {st.live && !camProblem && (
          <div className="live-bar">
            <button type="button" className="btn primary" onClick={() => session?.tap(0.5, 0.5)}><Icon name="tap" />Paint here</button>
            <button type="button" className="btn" onClick={capture}><Icon name="shutter" />Capture</button>
            <button type="button" className="btn" onClick={endCamera} aria-label="Stop camera"><Icon name="stop" /></button>
          </div>
        )}
        {empty && (
          <div className="stage-msg empty-state"><div className="card">
            <span className="empty-swatches" aria-hidden="true">{cat.shades.filter((_, i) => i % 6 === 0).slice(0, 7).map((s) => <i key={s.id} style={{ background: s.hex }} />)}</span>
            <h3>See your walls in a new colour</h3>
            <p>Point your camera at a wall, or use a photo of your room. Then tap the wall and pick a colour.</p>
            <div className="empty-actions">
              <button type="button" className="btn primary" onClick={() => void startCamera()}><span className="rec" />Live camera</button>
              <button type="button" className="btn" onClick={() => captureRef.current?.click()}><Icon name="camera" />Take a photo</button>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" />Upload a photo</button>
            </div>
          </div></div>
        )}
        {starting && <div className="stage-msg"><div className="card"><div className="spinner" /><p>Starting the camera… allow access if your browser asks.</p></div></div>}
        {help && (
          <div className="stage-msg" role="alert"><div className="card">
            <h3>{help.title}</h3>
            <p>{help.body}</p>
            <div className="row" style={{ justifyContent: "center" }}>
              <button type="button" className="btn primary" onClick={() => captureRef.current?.click()}><Icon name="camera" />Take a photo instead</button>
              {camProblem !== "insecure" && camProblem !== "not-found" && <button type="button" className="btn" onClick={() => void startCamera()}>Try again</button>}
              <button type="button" className="btn ghost" style={{ color: "#fff" }} onClick={() => setCamProblem(null)}>Back</button>
            </div>
          </div></div>
        )}
        {dragOver && <div className="drop">Drop your photo to paint it</div>}
      </div>

      {st.ready && (
        <>
          <div className="toolrow" role="toolbar" aria-label="Painting tools">
            {tools.map((t) => (
              <button key={t.id} type="button" className={`tool${st.tool === t.id ? " keep" : ""}`} aria-pressed={st.tool === t.id} aria-label={t.label} title={t.label} onClick={() => session?.setTool(t.id)} disabled={st.live && (t.id === "brush" || t.id === "erase")}>
                <Icon name={t.icon} /><span className="lbl">{t.label}</span>
              </button>
            ))}
            <span className="spacer" />
            <button type="button" className="tool icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!st.canUndo} onClick={() => session?.undo()}><Icon name="undo" /></button>
            <button type="button" className="tool icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!st.canRedo} onClick={() => session?.redo()}><Icon name="redo" /></button>
            <button type="button" className="tool" aria-label="Before / after" title="Before / after" aria-pressed={st.compare} disabled={st.live} onClick={() => session?.setCompare(!st.compare)}><Icon name="compare" /><span className="lbl">Before / after</span></button>
            <button type="button" className="tool" aria-label="Share" title="Share or save image" onClick={() => void shareResult()}><Icon name="share" /><span className="lbl">Share</span></button>
          </div>

          <div className="surfaces" role="group" aria-label="Walls">
            {st.surfaces.map((s, i) => {
              const sh = shade(s.shadeId);
              return (
                <button key={s.id} type="button" className={`surface-chip${s.painted ? "" : " empty"}`} aria-pressed={i === st.selected} onClick={() => session?.selectSurface(i)}>
                  <span className="sw" style={{ background: sh?.hex }} />
                  <span className="t">Wall {i + 1}<small>{s.painted ? sh?.name ?? "Unknown colour" : "Not painted yet"}</small></span>
                </button>
              );
            })}
            {st.surfaces.length < MAX_SURFACES && (
              <button type="button" className="surface-chip add" onClick={() => session?.addSurface()}><Icon name="plus" width={16} height={16} />Add wall</button>
            )}
          </div>

          {selected && (
            <div className="surface-tools">
              <div className="seg" role="group" aria-label="Finish">
                {FINISHES.map((f) => (
                  <button key={f.id} type="button" aria-pressed={selected.finish === f.id} onClick={() => session?.setFinish(st.selected, f.id)}>{f.label}</button>
                ))}
              </div>
              <button type="button" className="tool" disabled={!selected.painted} onClick={() => session?.clearSurface(st.selected)}>Clear wall</button>
              {st.surfaces.length > 1 && <button type="button" className="tool" onClick={() => session?.removeSurface(st.selected)}><Icon name="trash" />Remove</button>}
            </div>
          )}

          <div className="settings">
            {st.ai !== "disabled" && (
              <span className="seg" role="group" aria-label="Wall detection">
                <button type="button" aria-pressed={st.detector === "ai"} onClick={() => session?.setDetector("ai")} title="AI model; best on real photos">Smart</button>
                <button type="button" aria-pressed={st.detector === "classic"} onClick={() => session?.setDetector("classic")} title="Colour and edge based; works offline">Edge</button>
              </span>
            )}
            {(st.detector === "classic" || st.ai !== "ready") && (
              <label htmlFor="spread">Spread
                <input id="spread" type="range" min={5} max={70} value={st.spread} onChange={(e) => session?.setSpread(+e.target.value)} />
              </label>
            )}
            {(st.tool === "brush" || st.tool === "erase") && (
              <label htmlFor="brush-size">Brush size
                <input id="brush-size" type="range" min={1} max={12} value={Math.round(st.brushSize * 100)} onChange={(e) => session?.setBrushSize(+e.target.value / 100)} />
              </label>
            )}
          </div>
        </>
      )}
    </section>
  );
}
