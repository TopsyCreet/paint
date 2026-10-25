import { useEffect, useState } from "react";
import { useStore, type Tab } from "./store";
import { Visualizer } from "../features/visualizer/Visualizer";
import { ColourRail } from "../features/visualizer/ColourRail";
import { ColoursPanel } from "../features/colours/ColoursPanel";
import { CalculatorPanel } from "../features/calculator/CalculatorPanel";
import { OrderPanel } from "../features/order/OrderPanel";
import { ProjectsPanel } from "../features/projects/ProjectsPanel";
import { Icon, type IconName } from "../ui/icons";

type PanelTab = Exclude<Tab, "paint">;
const PANEL_TABS: Array<{ id: PanelTab; label: string; icon: IconName }> = [
  { id: "colours", label: "Colours", icon: "palette" },
  { id: "calc", label: "Quantity", icon: "ruler" },
  { id: "buy", label: "Buy", icon: "bag" },
  { id: "saved", label: "Saved", icon: "folder" },
];

interface InstallEvent extends Event { prompt: () => Promise<void> }

export function App() {
  const { cat, tab, setTab, isWide } = useStore();
  const [install, setInstall] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", on);
    window.addEventListener("appinstalled", () => setInstall(null));
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);

  // On wide screens the stage is always visible, so "paint" maps to the Colours panel.
  const panelTab: PanelTab = tab === "paint" ? "colours" : tab;
  const showStage = isWide || tab === "paint";
  const showPanel = isWide || tab !== "paint";

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
        {cat.brand.sampleDataNotice && <span className="notice-chip" title={cat.brand.sampleDataNotice}>Sample catalogue</span>}
        {install && (
          <button type="button" className="btn small" onClick={async () => { await install.prompt(); setInstall(null); }}>
            <Icon name="install" />Install app
          </button>
        )}
      </header>

      <main className="main">
        <div className="studio" hidden={!showStage}>
          <Visualizer />
          <ColourRail />
          <p className="footer">{cat.brand.disclaimer}{cat.brand.madeBy ? ` Built by ${cat.brand.madeBy}.` : ""}</p>
        </div>

        <aside className="panel" hidden={!showPanel} aria-label="Tools">
          <div className="panel-tabs" role="tablist">
            {PANEL_TABS.map((t) => (
              <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={panelTab === t.id} className="panel-tab" onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="panel-body">
            <div id="panel-colours" role="tabpanel" aria-labelledby="tab-colours" hidden={panelTab !== "colours"}><ColoursPanel /></div>
            <div id="panel-calc" role="tabpanel" aria-labelledby="tab-calc" hidden={panelTab !== "calc"}><CalculatorPanel /></div>
            <div id="panel-buy" role="tabpanel" aria-labelledby="tab-buy" hidden={panelTab !== "buy"}><OrderPanel visible={showPanel && panelTab === "buy"} /></div>
            <div id="panel-saved" role="tabpanel" aria-labelledby="tab-saved" hidden={panelTab !== "saved"}><ProjectsPanel visible={showPanel && panelTab === "saved"} /></div>
          </div>
        </aside>
      </main>

      <nav className="tabbar" aria-label="Sections">
        {([{ id: "paint", label: "Paint", icon: "paint" }, ...PANEL_TABS] as Array<{ id: Tab; label: string; icon: IconName }>).map((t) => (
          <button key={t.id} type="button" aria-selected={tab === t.id} onClick={() => { setTab(t.id); window.scrollTo({ top: 0 }); }}>
            <Icon name={t.icon} />{t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
