import { useStore } from "../../app/store";
import { track } from "../../lib/analytics";
import { useToast } from "../../ui/toast";

/** Applies a shade to the selected wall; on phones, returns to the paint view. */
export function useApplyShade() {
  const { session, pushRecent, setTab, isWide, shade, tab } = useStore();
  const toast = useToast();
  return (id: string, opts: { stay?: boolean } = {}) => {
    if (!session) return;
    const st = session.getState();
    session.setShade(st.selected, id);
    pushRecent(id);
    track("shade_applied", { code: shade(id)?.code ?? id });
    if (!isWide && !opts.stay && tab !== "paint") {
      setTab("paint");
      toast(`${shade(id)?.name ?? "Colour"} on Wall ${st.selected + 1}${st.surfaces[st.selected]?.painted ? "" : ". Tap a wall to paint it."}`);
    }
  };
}
