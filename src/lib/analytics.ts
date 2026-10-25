import type { Brand } from "../data/types";

/**
 * Pluggable analytics. Set brand.analytics to { provider: "ga4", id: "G-XXXX" }
 * or { provider: "plausible", id: "your-domain.com" }. Events never include
 * personal data: only colour codes, product ids and coarse counts.
 */
export type EventName =
  | "app_open" | "room_loaded" | "photo_loaded" | "camera_started" | "camera_error" | "camera_captured"
  | "surface_painted" | "shade_applied" | "colour_matched" | "image_shared" | "image_saved"
  | "calc_done" | "order_whatsapp" | "distributor_called" | "directions_opened" | "project_saved";

type Props = Record<string, string | number | boolean | undefined>;
type Sender = (name: EventName, props: Props) => void;

let send: Sender = (name, props) => {
  if (import.meta.env.DEV) console.debug("[analytics]", name, props);
};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    plausible?: (name: string, opts?: { props?: Props }) => void;
  }
}

function addScript(src: string, attrs: Record<string, string> = {}) {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
  document.head.appendChild(s);
}

export function initAnalytics(brand: Brand) {
  const { provider, id } = brand.analytics ?? { provider: "none" };
  if (!id) return;
  if (provider === "ga4") {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer!.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", id, { anonymize_ip: true });
    addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`);
    send = (name, props) => window.gtag?.("event", name, props);
  } else if (provider === "plausible") {
    addScript("https://plausible.io/js/script.js", { "data-domain": id });
    send = (name, props) => window.plausible?.(name, { props });
  }
}

export function track(name: EventName, props: Props = {}) {
  try { send(name, props); } catch { /* analytics must never break the app */ }
}
