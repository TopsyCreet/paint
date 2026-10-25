import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { App } from "./app/App";
import { StoreProvider } from "./app/store";
import { loadCatalogue } from "./data/catalogue";
import type { Catalogue } from "./data/types";
import { initAnalytics, track } from "./lib/analytics";
import { ToastProvider } from "./ui/toast";

function applyBrand(c: Catalogue) {
  const root = document.documentElement;
  root.style.setProperty("--brand", c.brand.colours.primary);
  root.style.setProperty("--brand-ink", c.brand.colours.primaryInk);
  document.title = c.brand.name;
}

function Boot() {
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    loadCatalogue()
      .then((c) => {
        applyBrand(c);
        initAnalytics(c.brand);
        track("app_open", {});
        setCat(c);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  if (error) {
    return (
      <div className="boot"><div className="card">
        <h2>The colour catalogue didn't load</h2>
        <p className="fine">{error} Check your connection and try again.</p>
        <button type="button" className="btn primary" onClick={() => location.reload()}>Try again</button>
      </div></div>
    );
  }
  if (!cat) return <div className="boot" aria-busy="true"><div className="card"><p className="fine">Loading colours…</p></div></div>;
  return (
    <StoreProvider cat={cat}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StoreProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
  });
}
