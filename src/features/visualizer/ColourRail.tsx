import { useSessionState, useStore } from "../../app/store";
import { useApplyShade } from "../colours/useApplyShade";

/** Quick colour strip under the stage on phones. */
export function ColourRail() {
  const { cat, session, recent, favourites, shade } = useStore();
  const st = useSessionState(session);
  const apply = useApplyShade();
  const current = st.surfaces[st.selected]?.shadeId;
  const byFamily = cat.families.map((f) => cat.shades.filter((s) => s.family === f.id));
  const mixed: string[] = [];
  for (let i = 0; mixed.length < cat.shades.length && i < 50; i++) byFamily.forEach((list) => { if (list[i]) mixed.push(list[i].id); });
  cat.shades.forEach((s) => { if (!mixed.includes(s.id)) mixed.push(s.id); });
  const ids = [...new Set([...recent, ...favourites, ...mixed])].slice(0, 48);
  return (
    <section className="rail-wrap" aria-label="Quick colours">
      <div className="rail-head">
        <span className="eyebrow">Colour for Wall {st.selected + 1}{current && shade(current) ? ` · ${shade(current)!.name}` : ""}</span>
        <button type="button" className="btn small ghost" onClick={() => document.getElementById("colours")?.scrollIntoView({ behavior: "smooth" })}>All colours</button>
      </div>
      <div className="rail">
        {ids.map((id) => {
          const s = shade(id);
          if (!s) return null;
          return <button key={id} type="button" style={{ background: s.hex }} aria-label={`${s.name}, ${s.code}`} title={s.name} aria-pressed={current === id} onClick={() => apply(id)} />;
        })}
      </div>
    </section>
  );
}
