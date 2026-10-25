import { useEffect, useMemo, useState } from "react";
import { DRAFT_KEY, loadCatalogue, validateCatalogue } from "../data/catalogue";
import type { Catalogue, Distributor, Finish, Product, Shade, Use } from "../data/types";
import { isHex } from "../engine/colour";
import { csvToObjects, slugify, toCsv } from "../lib/csv";
import { downloadText } from "../lib/share";
import { readJson, removeKey, writeJson } from "../lib/storage";

type Tab = "brand" | "shades" | "products" | "distributors" | "publish";

const FINISHES: Finish[] = ["matt", "satin", "silk", "gloss"];
const USES: Use[] = ["interior", "exterior", "both"];

function num(v: string, fallback = 0): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function readFile(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(fr.error);
    fr.readAsText(file);
  });
}

export function AdminApp() {
  const [cat, setCat] = useState<Catalogue | null>(null);
  const [tab, setTab] = useState<Tab>("shades");
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const draft = readJson<Catalogue | null>(DRAFT_KEY, null);
    if (draft?.shades) { setCat(draft); setMsg("Restored your unsaved draft from this browser."); return; }
    loadCatalogue().then(setCat).catch((e) => setMsg(String(e)));
  }, []);
  useEffect(() => { if (cat) writeJson(DRAFT_KEY, cat); }, [cat]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(""), 4000); return () => clearTimeout(t); }, [msg]);

  const issues = useMemo(() => (cat ? validateCatalogue(cat) : []), [cat]);
  if (!cat) return <div className="boot"><p className="fine">{msg || "Loading catalogue…"}</p></div>;

  const set = (patch: Partial<Catalogue>) => setCat({ ...cat, ...patch });
  const setShade = (i: number, p: Partial<Shade>) => set({ shades: cat.shades.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const setProduct = (i: number, p: Partial<Product>) => set({ products: cat.products.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const setDist = (i: number, p: Partial<Distributor>) => set({ distributors: cat.distributors.map((s, k) => (k === i ? { ...s, ...p } : s)) });

  const importShades = async (file: File, mode: "replace" | "append") => {
    const rows = csvToObjects(await readFile(file));
    const parsed: Shade[] = rows
      .map((r) => {
        const hex = (r.hex || r.colour || r.color || "").trim();
        const name = r.name || r.shade || "";
        return { id: r.id || slugify(name), name, code: r.code || "", hex: hex.startsWith("#") ? hex.toUpperCase() : `#${hex.toUpperCase()}`, family: slugify(r.family || "other"), collection: r.collection || undefined, lrv: r.lrv ? num(r.lrv) : undefined };
      })
      .filter((s) => s.name && isHex(s.hex));
    const fams = new Map(cat.families.map((f) => [f.id, f]));
    rows.forEach((r) => { const id = slugify(r.family || "other"); if (!fams.has(id)) fams.set(id, { id, label: r.family || "Other" }); });
    set({ shades: mode === "replace" ? parsed : [...cat.shades, ...parsed], families: [...fams.values()] });
    setMsg(`Imported ${parsed.length} shades${rows.length - parsed.length ? `; skipped ${rows.length - parsed.length} rows without a name or valid hex` : ""}.`);
  };

  const importDistributors = async (file: File, mode: "replace" | "append") => {
    const rows = csvToObjects(await readFile(file));
    const parsed: Distributor[] = rows
      .map((r) => ({
        id: r.id || slugify(`${r.name}-${r.city}`), name: r.name || "", address: r.address || "", city: r.city || "", state: r.state || "",
        lat: num(r.lat || r.latitude, NaN), lng: num(r.lng || r.lon || r.longitude, NaN), phone: r.phone || "", whatsapp: (r.whatsapp || "").replace(/[^0-9]/g, ""), hours: r.hours || "",
      }))
      .filter((d) => d.name && Number.isFinite(d.lat) && Number.isFinite(d.lng));
    set({ distributors: mode === "replace" ? parsed : [...cat.distributors, ...parsed] });
    setMsg(`Imported ${parsed.length} distributors${rows.length - parsed.length ? `; skipped ${rows.length - parsed.length} rows missing a name or coordinates` : ""}.`);
  };

  const publishFiles = () => {
    downloadText(JSON.stringify(cat.brand, null, 2) + "\n", "brand.json");
    setTimeout(() => downloadText(JSON.stringify({ families: cat.families, shades: cat.shades }, null, 2) + "\n", "shades.json"), 300);
    setTimeout(() => downloadText(JSON.stringify(cat.products, null, 2) + "\n", "products.json"), 600);
    setTimeout(() => downloadText(JSON.stringify(cat.distributors, null, 2) + "\n", "distributors.json"), 900);
  };

  const errors = issues.filter((i) => i.level === "error").length;
  const shown = cat.shades.map((s, i) => ({ s, i })).filter(({ s }) => !filter || `${s.name} ${s.code} ${s.family}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="admin">
      <header className="topbar">
        <div className="brandmark"><span className="logo" aria-hidden="true" /><div><h1>{cat.brand.name} · Catalogue manager</h1><p>Edit colours, products and distributors, then publish the files.</p></div></div>
        <span className="spacer" />
        <a className="btn small" href="./?preview=1" target="_blank" rel="noopener">Preview in app</a>
      </header>
      <nav className="panel-tabs admin-tabs" role="tablist">
        {(["brand", "shades", "products", "distributors", "publish"] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className="panel-tab" onClick={() => setTab(t)}>
            {t === "publish" ? `Check & publish${errors ? ` (${errors})` : ""}` : t[0].toUpperCase() + t.slice(1)}
            {t === "shades" ? ` (${cat.shades.length})` : t === "distributors" ? ` (${cat.distributors.length})` : ""}
          </button>
        ))}
      </nav>
      <main className="admin-body">
        {tab === "brand" && (
          <section className="admin-form">
            {([["name", "App name"], ["shortName", "Short name"], ["tagline", "Tagline"], ["madeBy", "Built by"], ["sampleDataNotice", "Sample-data notice (leave empty for real data)"], ["disclaimer", "Colour disclaimer"], ["whatsappFallback", "Default WhatsApp number (international, digits only)"], ["currency", "Currency code"], ["locale", "Locale"]] as Array<[keyof Catalogue["brand"], string]>).map(([k, label]) => (
              <div className="field" key={k}>
                <label htmlFor={`b-${k}`}>{label}</label>
                <input id={`b-${k}`} className="input" value={String(cat.brand[k] ?? "")} onChange={(e) => set({ brand: { ...cat.brand, [k]: e.target.value } })} />
              </div>
            ))}
            <div className="grid-2">
              <div className="field"><label htmlFor="b-primary">Brand colour</label><div className="row"><input type="color" value={isHex(cat.brand.colours.primary) ? cat.brand.colours.primary : "#4B37BF"} onChange={(e) => set({ brand: { ...cat.brand, colours: { ...cat.brand.colours, primary: e.target.value.toUpperCase() } } })} aria-label="Pick brand colour" /><input id="b-primary" className="input" value={cat.brand.colours.primary} onChange={(e) => set({ brand: { ...cat.brand, colours: { ...cat.brand.colours, primary: e.target.value } } })} /></div></div>
              <div className="field"><label htmlFor="b-ink">Text on brand colour</label><input id="b-ink" className="input" value={cat.brand.colours.primaryInk} onChange={(e) => set({ brand: { ...cat.brand, colours: { ...cat.brand.colours, primaryInk: e.target.value } } })} /></div>
            </div>
            <div className="grid-2">
              <div className="field"><label htmlFor="b-an">Analytics</label><select id="b-an" className="select" value={cat.brand.analytics.provider} onChange={(e) => set({ brand: { ...cat.brand, analytics: { ...cat.brand.analytics, provider: e.target.value as "none" } } })}><option value="none">None</option><option value="ga4">Google Analytics 4</option><option value="plausible">Plausible</option></select></div>
              <div className="field"><label htmlFor="b-anid">Measurement ID or domain</label><input id="b-anid" className="input" value={cat.brand.analytics.id ?? ""} onChange={(e) => set({ brand: { ...cat.brand, analytics: { ...cat.brand.analytics, id: e.target.value } } })} /></div>
            </div>
            <label className="check"><input type="checkbox" checked={cat.brand.segmentation.enabled} onChange={(e) => set({ brand: { ...cat.brand, segmentation: { ...cat.brand.segmentation, enabled: e.target.checked } } })} />Use smart (AI) wall detection</label>
            <div className="field"><label htmlFor="b-model">AI model URL</label><input id="b-model" className="input" value={cat.brand.segmentation.modelUrl} onChange={(e) => set({ brand: { ...cat.brand, segmentation: { ...cat.brand.segmentation, modelUrl: e.target.value } } })} /></div>
          </section>
        )}

        {tab === "shades" && (
          <section className="admin-section">
            <div className="row">
              <input className="input" style={{ maxWidth: 260 }} placeholder="Filter shades" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter shades" />
              <button type="button" className="btn small" onClick={() => set({ shades: [...cat.shades, { id: `new-shade-${cat.shades.length + 1}`, name: "New shade", code: "", hex: "#CCCCCC", family: cat.families[0]?.id ?? "other" }] })}>Add shade</button>
              <label className="btn small">Import CSV (replace)<input className="sr" type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importShades(f, "replace"); e.target.value = ""; }} /></label>
              <label className="btn small">Import CSV (add)<input className="sr" type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importShades(f, "append"); e.target.value = ""; }} /></label>
              <button type="button" className="btn small" onClick={() => downloadText(toCsv([["id", "name", "code", "hex", "family", "collection", "lrv"], ...cat.shades.map((s) => [s.id, s.name, s.code, s.hex, s.family, s.collection ?? "", s.lrv ?? ""])]), "shades.csv", "text/csv")}>Export CSV</button>
            </div>
            <p className="fine">CSV columns: name, code, hex, family (optional: id, collection, lrv). Families are created automatically.</p>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Colour</th><th>Name</th><th>Code</th><th>Hex</th><th>Family</th><th>LRV</th><th /></tr></thead>
                <tbody>
                  {shown.map(({ s, i }) => (
                    <tr key={i}>
                      <td><input type="color" value={isHex(s.hex) ? (s.hex.length === 4 ? s.hex : s.hex.slice(0, 7)) : "#000000"} onChange={(e) => setShade(i, { hex: e.target.value.toUpperCase() })} aria-label={`Colour for ${s.name}`} /></td>
                      <td><input className="input" value={s.name} onChange={(e) => setShade(i, { name: e.target.value })} onBlur={(e) => { if (s.id.startsWith("new-shade")) setShade(i, { id: slugify(e.target.value) }); }} aria-label="Name" /></td>
                      <td><input className="input mono" value={s.code} onChange={(e) => setShade(i, { code: e.target.value })} aria-label="Code" /></td>
                      <td><input className={`input mono${isHex(s.hex) ? "" : " invalid"}`} value={s.hex} onChange={(e) => setShade(i, { hex: e.target.value })} aria-label="Hex" /></td>
                      <td><select className="select" value={s.family} onChange={(e) => setShade(i, { family: e.target.value })} aria-label="Family">{cat.families.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></td>
                      <td><input className="input mono" style={{ width: 70 }} value={s.lrv ?? ""} placeholder="auto" onChange={(e) => setShade(i, { lrv: e.target.value === "" ? undefined : num(e.target.value) })} aria-label="LRV" /></td>
                      <td><button type="button" className="btn small ghost" onClick={() => set({ shades: cat.shades.filter((_, k) => k !== i) })} aria-label={`Delete ${s.name}`}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Families</h3>
            <div className="row">
              {cat.families.map((f, i) => (
                <input key={i} className="input" style={{ width: 170 }} value={f.label} aria-label={`Family ${f.id}`} onChange={(e) => set({ families: cat.families.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
              ))}
              <button type="button" className="btn small" onClick={() => set({ families: [...cat.families, { id: `family-${cat.families.length + 1}`, label: "New family" }] })}>Add family</button>
            </div>
          </section>
        )}

        {tab === "products" && (
          <section className="admin-section">
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Id</th><th>Finish</th><th>Use</th><th>m² per litre</th><th>Tins (litres:price, …)</th><th /></tr></thead>
                <tbody>
                  {cat.products.map((p, i) => (
                    <tr key={i}>
                      <td><input className="input" value={p.name} onChange={(e) => setProduct(i, { name: e.target.value })} aria-label="Name" /></td>
                      <td><input className="input mono" value={p.id} onChange={(e) => setProduct(i, { id: slugify(e.target.value) })} aria-label="Id" /></td>
                      <td><select className="select" value={p.finish} onChange={(e) => setProduct(i, { finish: e.target.value as Finish })} aria-label="Finish">{FINISHES.map((f) => <option key={f}>{f}</option>)}</select></td>
                      <td><select className="select" value={p.use} onChange={(e) => setProduct(i, { use: e.target.value as Use })} aria-label="Use">{USES.map((f) => <option key={f}>{f}</option>)}</select></td>
                      <td><input className="input mono" style={{ width: 80 }} value={p.coverage} onChange={(e) => setProduct(i, { coverage: num(e.target.value) })} aria-label="Coverage" /></td>
                      <td><input className="input mono" defaultValue={p.sizes.map((s) => `${s.litres}:${s.price}`).join(", ")} onBlur={(e) => setProduct(i, { sizes: e.target.value.split(",").map((x) => x.split(":")).filter((x) => x.length === 2).map(([l, pr]) => ({ litres: num(l), price: num(pr) })).filter((s) => s.litres > 0) })} aria-label="Tin sizes" /></td>
                      <td><button type="button" className="btn small ghost" onClick={() => set({ products: cat.products.filter((_, k) => k !== i) })}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="btn small" onClick={() => set({ products: [...cat.products, { id: `product-${cat.products.length + 1}`, name: "New product", finish: "matt", use: "interior", coverage: 10, sizes: [{ litres: 4, price: 0 }] }] })}>Add product</button>
          </section>
        )}

        {tab === "distributors" && (
          <section className="admin-section">
            <div className="row">
              <button type="button" className="btn small" onClick={() => set({ distributors: [...cat.distributors, { id: `distributor-${cat.distributors.length + 1}`, name: "New distributor", address: "", city: "", state: "", lat: 6.5244, lng: 3.3792, phone: "", whatsapp: "", hours: "" }] })}>Add distributor</button>
              <label className="btn small">Import CSV (replace)<input className="sr" type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importDistributors(f, "replace"); e.target.value = ""; }} /></label>
              <label className="btn small">Import CSV (add)<input className="sr" type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importDistributors(f, "append"); e.target.value = ""; }} /></label>
              <button type="button" className="btn small" onClick={() => downloadText(toCsv([["id", "name", "address", "city", "state", "lat", "lng", "phone", "whatsapp", "hours"], ...cat.distributors.map((d) => [d.id, d.name, d.address, d.city, d.state, d.lat, d.lng, d.phone ?? "", d.whatsapp ?? "", d.hours ?? ""])]), "distributors.csv", "text/csv")}>Export CSV</button>
            </div>
            <p className="fine">CSV columns: name, address, city, state, lat, lng, phone, whatsapp, hours. Get coordinates by right-clicking the shop in Google Maps.</p>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Address</th><th>City</th><th>State</th><th>Lat</th><th>Lng</th><th>Phone</th><th>WhatsApp</th><th>Sample</th><th /></tr></thead>
                <tbody>
                  {cat.distributors.map((d, i) => (
                    <tr key={i}>
                      <td><input className="input" value={d.name} onChange={(e) => setDist(i, { name: e.target.value })} aria-label="Name" /></td>
                      <td><input className="input" value={d.address} onChange={(e) => setDist(i, { address: e.target.value })} aria-label="Address" /></td>
                      <td><input className="input" value={d.city} onChange={(e) => setDist(i, { city: e.target.value })} aria-label="City" /></td>
                      <td><input className="input" value={d.state} onChange={(e) => setDist(i, { state: e.target.value })} aria-label="State" /></td>
                      <td><input className="input mono" style={{ width: 96 }} value={d.lat} onChange={(e) => setDist(i, { lat: num(e.target.value, NaN) })} aria-label="Latitude" /></td>
                      <td><input className="input mono" style={{ width: 96 }} value={d.lng} onChange={(e) => setDist(i, { lng: num(e.target.value, NaN) })} aria-label="Longitude" /></td>
                      <td><input className="input mono" value={d.phone ?? ""} onChange={(e) => setDist(i, { phone: e.target.value })} aria-label="Phone" /></td>
                      <td><input className="input mono" value={d.whatsapp ?? ""} onChange={(e) => setDist(i, { whatsapp: e.target.value.replace(/[^0-9]/g, "") })} aria-label="WhatsApp" /></td>
                      <td><input type="checkbox" checked={!!d.sample} onChange={(e) => setDist(i, { sample: e.target.checked || undefined })} aria-label="Sample record" /></td>
                      <td><button type="button" className="btn small ghost" onClick={() => set({ distributors: cat.distributors.filter((_, k) => k !== i) })}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "publish" && (
          <section className="admin-form">
            <h2>{errors ? `${errors} problem${errors > 1 ? "s" : ""} to fix before publishing` : "Ready to publish"}</h2>
            {issues.length ? (
              <ul className="issues">{issues.map((x, i) => <li key={i} className={x.level}><strong>{x.where}:</strong> {x.message}</li>)}</ul>
            ) : <p className="fine">No problems found.</p>}
            <ol className="steps">
              <li>Open <a href="./?preview=1" target="_blank" rel="noopener">the app in preview mode</a> to check everything on your phone and computer.</li>
              <li>Download the four data files below.</li>
              <li>Replace the files in <code>public/data/</code> of the GitHub repository with them (GitHub: Add file → Upload files) and commit. The site redeploys in about two minutes.</li>
            </ol>
            <div className="row">
              <button type="button" className="btn primary" disabled={errors > 0} onClick={publishFiles}>Download data files</button>
              <button type="button" className="btn" onClick={() => { removeKey(DRAFT_KEY); location.reload(); }}>Discard draft and reload published data</button>
            </div>
          </section>
        )}
      </main>
      <div className="toast" role="status" hidden={!msg}>{msg}</div>
    </div>
  );
}
