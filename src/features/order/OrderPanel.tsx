import { useMemo, useState } from "react";
import { useSessionState, useStore } from "../../app/store";
import { cheapestTins, describeTins, totalsByProduct } from "../../lib/calc";
import { currentPosition, directionsUrl, formatKm, sortByDistance } from "../../lib/geo";
import { orderMessage, telUrl, whatsappUrl, type OrderLine } from "../../lib/order";
import { copyText } from "../../lib/share";
import { track } from "../../lib/analytics";
import { Icon } from "../../ui/icons";
import { useToast } from "../../ui/toast";
import { MapView } from "./MapView";

export function OrderPanel({ visible }: { visible: boolean }) {
  const { cat, session, shade, product, rooms, orderQty, setOrderQty, money, setTab } = useStore();
  const st = useSessionState(session);
  const toast = useToast();
  const cities = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number; n: number }>();
    cat.distributors.forEach((d) => {
      const key = `${d.city}, ${d.state}`;
      const c = m.get(key) ?? { lat: 0, lng: 0, n: 0 };
      c.lat += d.lat; c.lng += d.lng; c.n++;
      m.set(key, c);
    });
    return [...m.entries()].map(([name, c]) => ({ name, lat: c.lat / c.n, lng: c.lng / c.n }));
  }, [cat.distributors]);
  const [area, setArea] = useState(cities[0]?.name ?? "");
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const origin = me ?? cities.find((c) => c.name === area) ?? cities[0];
  const nearby = useMemo(() => (origin ? sortByDistance(cat.distributors, origin).slice(0, 6) : []), [cat.distributors, origin]);
  const selected = nearby.find((d) => d.id === selectedId) ?? nearby[0];

  // Order lines: each painted colour, sized from the calculator when it has rooms.
  const calcTotals = useMemo(() => totalsByProduct(rooms, cat.products), [rooms, cat.products]);
  const defaultProductId = rooms[0]?.productId ?? cat.products[0]?.id;
  const shadeIds = useMemo(() => {
    const painted = [...new Set(st.surfaces.filter((s) => s.painted).map((s) => s.shadeId))];
    if (painted.length) return painted;
    const sel = st.surfaces[st.selected]?.shadeId;
    return sel ? [sel] : [];
  }, [st.surfaces, st.selected]);

  const lines: OrderLine[] = shadeIds.flatMap((id) => {
    const s = shade(id);
    const productId = orderQty[id]?.productId ?? defaultProductId;
    const p = productId ? product(productId) : undefined;
    if (!s || !p) return [];
    const sameProduct = shadeIds.filter((x) => (orderQty[x]?.productId ?? defaultProductId) === p.id).length || 1;
    const fromCalc = calcTotals.find((t) => t.product.id === p.id)?.litres ?? 0;
    const litres = orderQty[id]?.litres ?? (fromCalc > 0 ? Math.ceil((fromCalc / sameProduct) * 2) / 2 : 4);
    return [{ shade: s, product: p, litres, plan: cheapestTins(litres, p.sizes) }];
  });
  const total = lines.reduce((s, l) => s + l.plan.cost, 0);

  const setLine = (id: string, patch: { productId?: string; litres?: number }) => setOrderQty({ ...orderQty, [id]: { ...orderQty[id], ...patch } });

  const locate = async () => {
    setLocating(true);
    try {
      const p = await currentPosition();
      setMe({ lat: p.lat, lng: p.lng });
      setSelectedId(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Your location couldn't be found.");
    } finally {
      setLocating(false);
    }
  };

  const message = selected
    ? orderMessage({ distributor: selected, lines, customerArea: me ? undefined : area, brandName: cat.brand.name, money })
    : "";
  const waNumber = selected?.whatsapp || cat.brand.whatsappFallback || "";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <span className="eyebrow">Buy</span>
        <h2>Order from a distributor near you</h2>
      </div>

      <section className="order-lines" aria-label="Your order">
        {lines.length === 0 && <p className="empty">Paint a wall first, then your colours appear here.</p>}
        {lines.map((l) => (
          <div key={l.shade.id} className="order-line">
            <span className="c" style={{ background: l.shade.hex }} />
            <div className="body">
              <div><strong>{l.shade.name}</strong> <span className="mono fine">{l.shade.code}</span></div>
              <div className="field">
                <label className="sr" htmlFor={`op-${l.shade.id}`}>Paint for {l.shade.name}</label>
                <select id={`op-${l.shade.id}`} className="select" value={l.product.id} onChange={(e) => setLine(l.shade.id, { productId: e.target.value })}>
                  {cat.products.filter((p) => !l.shade.products || l.shade.products.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div className="stepper" role="group" aria-label={`Litres of ${l.shade.name}`}>
                  <button type="button" aria-label="Less" onClick={() => setLine(l.shade.id, { litres: Math.max(1, l.litres - 1) })}>−</button>
                  <span>{l.litres} L</span>
                  <button type="button" aria-label="More" onClick={() => setLine(l.shade.id, { litres: l.litres + 1 })}>+</button>
                </div>
                <span className="mono fine">{describeTins(l.plan) || "—"}</span>
              </div>
            </div>
          </div>
        ))}
        {lines.length > 0 && (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="fine">Estimated total · <button type="button" className="btn small ghost" style={{ padding: 0, minHeight: 0, textDecoration: "underline" }} onClick={() => setTab("calc")}>change room sizes</button></span>
            <strong className="mono">{money(total)}</strong>
          </div>
        )}
      </section>

      <section style={{ display: "grid", gap: 10 }} aria-label="Find a distributor">
        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor="area">Your area</label>
            <select id="area" className="select" value={me ? "__me" : area} onChange={(e) => { setMe(null); setArea(e.target.value); setSelectedId(null); }}>
              {me && <option value="__me">My location</option>}
              {cities.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          <button type="button" className="btn" style={{ alignSelf: "end" }} onClick={() => void locate()} disabled={locating}>
            <Icon name="locate" />{locating ? "Finding you…" : "Use my location"}
          </button>
        </div>
        <MapView distributors={nearby} selectedId={selected?.id ?? null} me={me} onSelect={setSelectedId} visible={visible} />
        <div className="dists">
          {nearby.map((d) => (
            <div key={d.id} className="dist" aria-current={d.id === selected?.id}>
              <button type="button" className="dist-head" style={{ background: "none", border: 0, padding: 0, textAlign: "left" }} onClick={() => setSelectedId(d.id)}>
                <span>
                  <span className="name">{d.name}</span>{d.sample && <span className="badge">Sample</span>}
                  <span className="addr" style={{ display: "block" }}>{d.address}, {d.city}{d.hours ? ` · ${d.hours}` : ""}</span>
                </span>
                <span className="km">{formatKm(d.km)}</span>
              </button>
              {d.id === selected?.id && (
                <div className="row">
                  <a className="btn small" href={directionsUrl(d)} target="_blank" rel="noopener" onClick={() => track("directions_opened", {})}><Icon name="route" />Directions</a>
                  {d.phone && <a className="btn small" href={telUrl(d.phone)} onClick={() => track("distributor_called", {})}><Icon name="phone" />{d.phone}</a>}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {selected && lines.length > 0 && (
        <section style={{ display: "grid", gap: 10 }} aria-label="WhatsApp order">
          <div className="field">
            <label htmlFor="order-msg">Your order message to {selected.name}</label>
            <textarea id="order-msg" className="msg" readOnly value={message} />
          </div>
          <div className="row">
            <a className="btn wa" href={whatsappUrl(message, waNumber)} target="_blank" rel="noopener" onClick={() => track("order_whatsapp", { lines: lines.length, distributor: selected.id })}>
              <Icon name="whatsapp" />Send on WhatsApp
            </a>
            <button type="button" className="btn" onClick={async () => toast((await copyText(message)) ? "Order message copied." : "Couldn't copy. Select the message and copy it.")}><Icon name="copy" />Copy</button>
          </div>
          {!waNumber && <p className="fine">This distributor has no WhatsApp number yet, so WhatsApp will ask you to choose who to send the order to.</p>}
        </section>
      )}
    </div>
  );
}
