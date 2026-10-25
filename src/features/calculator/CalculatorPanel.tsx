import { useEffect, useMemo, useRef } from "react";
import { newRoom, useStore } from "../../app/store";
import { DOOR_AREA, WINDOW_AREA, describeTins, totalsByProduct, wallArea, type Room } from "../../lib/calc";
import { track } from "../../lib/analytics";
import { Icon } from "../../ui/icons";

function Num({ id, label, value, onChange, step = 0.1, min = 0 }: { id: string; label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type="number"
        inputMode={step < 1 ? "decimal" : "numeric"}
        min={min}
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Math.max(min, parseFloat(e.target.value)))}
      />
    </div>
  );
}

export function CalculatorPanel() {
  const { cat, rooms, setRooms, money, setTab } = useStore();
  const totals = useMemo(() => totalsByProduct(rooms, cat.products), [rooms, cat.products]);
  const totalCost = totals.reduce((s, t) => s + t.plan.cost, 0);
  const totalLitres = totals.reduce((s, t) => s + t.litres, 0);
  const tracked = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (totalLitres > 0 && Math.abs(totalLitres - tracked.current) > 0.5) {
        tracked.current = totalLitres;
        track("calc_done", { litres: Math.round(totalLitres), rooms: rooms.length });
      }
    }, 1500);
    return () => window.clearTimeout(t);
  }, [totalLitres, rooms.length]);

  const update = (id: string, patch: Partial<Room>) => setRooms(rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const defaultProduct = cat.products.find((p) => p.use !== "exterior")?.id ?? cat.products[0].id;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <span className="eyebrow">Paint calculator</span>
        <h2>How much paint you need</h2>
      </div>
      <div className="rooms">
        {rooms.map((r, i) => {
          const area = wallArea(r);
          return (
            <section key={r.id} className="room" aria-label={r.name || `Room ${i + 1}`}>
              <div className="room-head">
                <label className="sr" htmlFor={`rn-${r.id}`}>Room name</label>
                <input id={`rn-${r.id}`} className="input" value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} />
                {rooms.length > 1 && (
                  <button type="button" className="btn small ghost" aria-label={`Remove ${r.name}`} onClick={() => setRooms(rooms.filter((x) => x.id !== r.id))}><Icon name="trash" /></button>
                )}
              </div>
              <div className="grid-3">
                <Num id={`l-${r.id}`} label="Length (m)" value={r.length} onChange={(v) => update(r.id, { length: v })} />
                <Num id={`w-${r.id}`} label="Width (m)" value={r.width} onChange={(v) => update(r.id, { width: v })} />
                <Num id={`h-${r.id}`} label="Height (m)" value={r.height} onChange={(v) => update(r.id, { height: v })} />
                <Num id={`d-${r.id}`} label="Doors" value={r.doors} step={1} onChange={(v) => update(r.id, { doors: Math.round(v) })} />
                <Num id={`wi-${r.id}`} label="Windows" value={r.windows} step={1} onChange={(v) => update(r.id, { windows: Math.round(v) })} />
                <div className="field">
                  <label htmlFor={`c-${r.id}`}>Coats</label>
                  <select id={`c-${r.id}`} className="select" value={r.coats} onChange={(e) => update(r.id, { coats: +e.target.value })}>
                    {[1, 2, 3].map((n) => <option key={n} value={n}>{n} coat{n > 1 ? "s" : ""}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor={`p-${r.id}`}>Paint</label>
                <select id={`p-${r.id}`} className="select" value={r.productId} onChange={(e) => update(r.id, { productId: e.target.value })}>
                  {cat.products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.coverage} m²/L</option>)}
                </select>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <label className="check"><input type="checkbox" checked={r.ceiling} onChange={(e) => update(r.id, { ceiling: e.target.checked })} />Include ceiling</label>
                <span className="mono fine">{area.toFixed(1)} m² to paint</span>
              </div>
            </section>
          );
        })}
      </div>
      <button type="button" className="btn" onClick={() => setRooms([...rooms, newRoom(defaultProduct, `Room ${rooms.length + 1}`)])}><Icon name="plus" />Add another room</button>

      <section className="result" aria-label="Paint needed">
        <div>
          <span className="eyebrow">You need about</span>
          <div className="big">{totalLitres.toFixed(1)} <small>litres in total</small></div>
        </div>
        {totals.map((t) => (
          <div key={t.product.id} style={{ display: "grid", gap: 6 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong style={{ fontSize: 14 }}>{t.product.name}</strong>
              <span className="mono fine">{t.litres.toFixed(1)} L for {t.area.toFixed(0)} m²</span>
            </div>
            <div className="tins">{t.plan.tins.length ? t.plan.tins.map((x) => <span key={x.size.litres} className="tin">{x.count} × {x.size.litres} L</span>) : <span className="fine">Enter room sizes to see tins.</span>}</div>
          </div>
        ))}
        <dl className="kv">
          <dt>Rooms</dt><dd>{rooms.length}</dd>
          <dt>Estimated cost</dt><dd>{money(totalCost)}</dd>
        </dl>
        <button type="button" className="btn primary" disabled={!totalLitres} onClick={() => setTab("buy")}><Icon name="bag" />Order this paint</button>
        {totals.length > 0 && <p className="fine">Tins chosen for the lowest price: {totals.map((t) => describeTins(t.plan)).filter(Boolean).join("; ")}.</p>}
      </section>
      <p className="fine">Doors count as {DOOR_AREA} m² and windows as {WINDOW_AREA} m². Rough or new plaster can take 10–20% more paint. Prices are estimates; your distributor confirms the final price.</p>
    </div>
  );
}
