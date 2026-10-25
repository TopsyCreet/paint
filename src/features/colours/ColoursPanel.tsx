import { useMemo, useState } from "react";
import { useSessionState, useStore } from "../../app/store";
import { hueOf, lrvFromHex, matchLabel } from "../../engine/colour";
import type { Shade } from "../../data/types";
import { Icon } from "../../ui/icons";
import { useApplyShade } from "./useApplyShade";

function pairingsFor(s: Shade, all: Shade[]): Shade[] {
  const lrv = (x: Shade) => x.lrv ?? lrvFromHex(x.hex);
  const out: Shade[] = [];
  // A trim: the lightest white for mid/dark colours, the deepest dark for pale ones.
  const trim = lrv(s) > 60
    ? [...all].sort((a, b) => lrv(a) - lrv(b))[0]
    : [...all].filter((x) => x.family === "white" || lrv(x) > 80).sort((a, b) => lrv(b) - lrv(a))[0];
  if (trim && trim.id !== s.id) out.push(trim);
  // A tonal partner from the same family.
  const tonal = all.filter((x) => x.family === s.family && x.id !== s.id && !out.includes(x)).sort((a, b) => Math.abs(lrv(a) - lrv(s) - 15) - Math.abs(lrv(b) - lrv(s) - 15))[0];
  if (tonal) out.push(tonal);
  // An accent roughly opposite on the colour wheel.
  const h = hueOf(s.hex);
  const accent = all
    .filter((x) => x.family !== s.family && !out.includes(x) && lrv(x) < 70 && lrv(x) > 8)
    .sort((a, b) => Math.abs(((hueOf(a.hex) - h + 540) % 360) - 180) - Math.abs(((hueOf(b.hex) - h + 540) % 360) - 180))[0];
  if (accent) out.push(accent);
  return out;
}

export function ColoursPanel() {
  const { cat, session, shade, favourites, toggleFavourite, match, setMatch, setTab, product } = useStore();
  const st = useSessionState(session);
  const apply = useApplyShade();
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string>("all");
  const currentId = st.surfaces[st.selected]?.shadeId;
  const current = currentId ? shade(currentId) : undefined;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cat.shades.filter((s) => {
      if (family === "saved" && !favourites.includes(s.id)) return false;
      if (family !== "all" && family !== "saved" && s.family !== family) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || s.hex.toLowerCase().includes(q.replace(/^#?/, "#"));
    });
  }, [cat.shades, query, family, favourites]);

  const fav = current ? favourites.includes(current.id) : false;
  const products = current ? cat.products.filter((p) => !current.products || current.products.includes(p.id)) : [];

  return (
    <div className="panel-section" style={{ display: "grid", gap: 16 }}>
      {match && (
        <section className="match-card" aria-label="Colour match">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="row">
              <span style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid var(--line)", background: `rgb(${match.rgb.map(Math.round).join(",")})` }} />
              <h3>Closest colours to what you tapped</h3>
            </div>
            <button type="button" className="btn small ghost" aria-label="Close matches" onClick={() => setMatch(null)}><Icon name="close" /></button>
          </div>
          {match.matches.map(({ item, deltaE }) => (
            <div key={item.id} className="match-row">
              <span className="c" style={{ background: item.hex }} />
              <div>
                <div style={{ fontWeight: 600 }}>{item.name} <span className="mono fine">{item.code}</span></div>
                <div className="fine">{matchLabel(deltaE)} · ΔE {deltaE.toFixed(1)}</div>
              </div>
              <button type="button" className="btn small" onClick={() => apply(item.id)}>Use</button>
            </div>
          ))}
          <p className="fine">ΔE measures colour difference: under 2 is hard to tell apart. Lighting in the photo affects the reading.</p>
        </section>
      )}

      {current && (
        <section className="shade-hero" aria-label="Selected colour">
          <div className="chip-big" style={{ background: current.hex }} />
          <div className="shade-meta">
            <span className="eyebrow">Wall {st.selected + 1} · {cat.families.find((f) => f.id === current.family)?.label ?? current.family}</span>
            <span className="name">{current.name}</span>
            <span className="facts"><span>{current.code}</span><span>LRV {current.lrv ?? lrvFromHex(current.hex)}</span><span>{current.hex.toUpperCase()}</span></span>
            <div className="pairs" aria-label="Goes well with">
              {pairingsFor(current, cat.shades).map((p) => (
                <button key={p.id} type="button" className="pair" onClick={() => apply(p.id)} title={`Use ${p.name}`}>
                  <i style={{ background: p.hex }} />{p.name}
                </button>
              ))}
            </div>
            <div className="row">
              <button type="button" className="btn small" aria-pressed={fav} onClick={() => toggleFavourite(current.id)}>
                <Icon name="star" fill={fav ? "currentColor" : "none"} />{fav ? "Saved" : "Save colour"}
              </button>
              <button type="button" className="btn small" onClick={() => setTab("buy")}><Icon name="bag" />Where to buy</button>
            </div>
            {products.length > 0 && <p className="fine">Available in {products.map((p) => product(p.id)?.name).join(", ")}.</p>}
          </div>
        </section>
      )}

      <div className="search">
        <Icon name="search" />
        <label className="sr" htmlFor="shade-search">Search colours</label>
        <input id="shade-search" className="input" type="search" placeholder="Search by name or code" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="families" role="group" aria-label="Colour families">
        {[{ id: "all", label: "All" }, ...cat.families, { id: "saved", label: `Saved (${favourites.length})` }].map((f) => (
          <button key={f.id} type="button" className="fam" aria-pressed={family === f.id} onClick={() => setFamily(f.id)}>{f.label}</button>
        ))}
      </div>
      {list.length ? (
        <div className="swatches">
          {list.map((s) => (
            <button key={s.id} type="button" className="swatch" aria-pressed={s.id === currentId} onClick={() => apply(s.id)} aria-label={`${s.name}, ${s.code}`}>
              <span className="c" style={{ background: s.hex }} />
              <span className="t"><span className="n">{s.name}</span><span className="k">{s.code}</span></span>
              {favourites.includes(s.id) && <span className="star" aria-hidden="true">★</span>}
            </button>
          ))}
        </div>
      ) : (
        <p className="empty">{family === "saved" ? "No saved colours yet. Tap Save colour on a shade to keep it here." : `No colours match "${query}".`}</p>
      )}
    </div>
  );
}
