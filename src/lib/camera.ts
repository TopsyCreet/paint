/**
 * Opens the rear camera and explains failures in plain language. Most "camera
 * doesn't work" reports come from in-app browsers (WhatsApp, Instagram,
 * Facebook), refused permission, or a page not served over HTTPS.
 */
export type CameraProblem =
  | "insecure" | "unsupported" | "in-app" | "denied" | "not-found" | "in-use" | "embedded" | "unknown";

export class CameraError extends Error {
  constructor(public problem: CameraProblem, message: string) {
    super(message);
  }
}

export function inAppBrowser(ua = navigator.userAgent): string | null {
  if (/WhatsApp/i.test(ua)) return "WhatsApp";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return "Facebook";
  if (/Snapchat/i.test(ua)) return "Snapchat";
  if (/TikTok|musical_ly|BytedanceWebview/i.test(ua)) return "TikTok";
  if (/Twitter/i.test(ua)) return "X";
  if (/LinkedInApp/i.test(ua)) return "LinkedIn";
  if (/; wv\)/.test(ua)) return "this app";
  return null;
}

export function cameraHelp(problem: CameraProblem, app?: string | null): { title: string; body: string } {
  switch (problem) {
    case "insecure":
      return { title: "The camera needs a secure link", body: "Open the app from an https:// address. Camera access is blocked on plain http pages." };
    case "in-app":
      return { title: `Open in your browser to use the camera`, body: `${app ?? "This app"}'s built-in browser blocks the camera. Tap the ⋮ or share menu and choose "Open in Chrome" (or "Open in Safari" on iPhone).` };
    case "unsupported":
      return { title: "This browser can't use the camera", body: "Open the app in a recent version of Chrome, Safari, Edge or Samsung Internet." };
    case "denied":
      return { title: "Camera permission is off", body: "Allow camera access for this site: tap the lock or ⓘ icon next to the address, open Permissions, set Camera to Allow, then try again." };
    case "not-found":
      return { title: "No camera found", body: "This device doesn't report a camera. Use a photo of your room instead." };
    case "in-use":
      return { title: "The camera is busy", body: "Another app is using the camera. Close it (a video call or camera app) and try again." };
    case "embedded":
      return { title: "Camera is blocked in this preview", body: "Open the app on its own page to use the live camera. Photos work here." };
    default:
      return { title: "The camera couldn't start", body: "Try again, or use a photo of your room instead." };
  }
}

function isEmbedded(): boolean {
  try { return window.self !== window.top; } catch { return true; }
}

export async function openRearCamera(): Promise<MediaStream> {
  if (!window.isSecureContext) throw new CameraError("insecure", "Insecure context");
  const app = inAppBrowser();
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError(app ? "in-app" : "unsupported", "getUserMedia unavailable");
  const attempts: MediaStreamConstraints[] = [
    { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
    { audio: false, video: { facingMode: "environment" } },
    { audio: false, video: true },
  ];
  let last: unknown = null;
  for (const c of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(c);
    } catch (e) {
      last = e;
      const name = e instanceof DOMException ? e.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") break;
    }
  }
  const name = last instanceof DOMException ? last.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    if (isEmbedded()) throw new CameraError("embedded", name);
    if (app) throw new CameraError("in-app", name);
    throw new CameraError("denied", name);
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") throw new CameraError("not-found", name);
  if (name === "NotSupportedError" || name === "TypeError") throw new CameraError(app ? "in-app" : "unsupported", name);
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") throw new CameraError("in-use", name);
  throw new CameraError(app ? "in-app" : "unknown", String(last));
}

/**
 * Attaches a stream to a video element that lives in the DOM (iOS Safari will
 * not decode frames for WebGL from a detached video) and waits for frames.
 */
export async function playStream(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.muted = true;
  video.autoplay = true;
  video.srcObject = stream;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new CameraError("unknown", "Timed out waiting for video")), 10000);
    const ok = () => { clearTimeout(t); resolve(); };
    if (video.readyState >= 2 && video.videoWidth) ok();
    else video.addEventListener("loadeddata", ok, { once: true });
  });
  try { await video.play(); } catch { /* autoplay with muted video normally succeeds; frames still flow */ }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}
