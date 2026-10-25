import { useStore } from "../../app/store";
import { track } from "../../lib/analytics";

/** Applies a shade to the selected wall. */
export function useApplyShade() {
  const { session, pushRecent, shade } = useStore();
  return (id: string) => {
    if (!session) return;
    const st = session.getState();
    session.setShade(st.selected, id);
    pushRecent(id);
    track("shade_applied", { code: shade(id)?.code ?? id });
  };
}
