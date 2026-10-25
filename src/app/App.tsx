import { useEffect, useState } from "react";
import { useStore } from "./store";
import { Visualizer } from "../features/visualizer/Visualizer";
import { ColourRail } from "../features/visualizer/ColourRail";
import { ColoursPanel } from "../features/colours/ColoursPanel";
import { Icon } from "../ui/icons";

interface InstallEvent extends Event { prompt: () => Promise<void> }

export function App() {
  const { cat } = useStore();
  const [install, setInstall] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", on);
    window.addEventListener("appinstalled", () => setInstall(null));
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brandmark">
          <span className="logo" aria-hidden="true" />
          <div>
            <h1>{cat.brand.name}</h1>
            <p className="tagline">{cat.brand.tagline}</p>
          </div>
        </div>
        <span className="spacer" />
        {cat.brand.sampleDataNotice && <span className="notice-chip" title={cat.brand.sampleDataNotice}>Sample colours</span>}
        {install && (
          <button type="button" className="btn small" onClick={async () => { await install.prompt(); setInstall(null); }}>
            <Icon name="install" />Install app
          </button>
        )}
      </header>

      <main className="main">
        <div className="studio">
          <Visualizer />
          <ColourRail />
          <p className="footer">{cat.brand.disclaimer}{cat.brand.madeBy ? ` Built by ${cat.brand.madeBy}.` : ""}</p>
        </div>
        <aside className="panel" id="colours" aria-label="Colours">
          <div className="panel-head"><h2>Colours</h2></div>
          <div className="panel-body"><ColoursPanel /></div>
        </aside>
      </main>
    </div>
  );
}
