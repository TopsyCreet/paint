import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Catalogue, Shade } from "../data/types";
import type { PaintSession, SessionState } from "../engine/session";
import type { Match, RGB } from "../engine/colour";
import { readJson, writeJson } from "../lib/storage";

export interface MatchResult {
  rgb: RGB;
  matches: Match<Shade>[];
}

interface Store {
  cat: Catalogue;
  shade: (id: string) => Shade | undefined;
  session: PaintSession | null;
  setSession: (s: PaintSession | null) => void;
  favourites: string[];
  toggleFavourite: (id: string) => void;
  recent: string[];
  pushRecent: (id: string) => void;
  match: MatchResult | null;
  setMatch: (m: MatchResult | null) => void;
  isWide: boolean;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}

export function useMedia(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    const m = window.matchMedia(query);
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true);
}

const EMPTY_STATE: SessionState = {
  ready: false, sourceKind: "room", live: false, surfaces: [], selected: 0, tool: "tap", spread: 45, brushSize: 0.04,
  compare: false, split: 0.5, canUndo: false, canRedo: false, detector: "classic", ai: "idle", aiError: "", busy: false, aspect: 1.5,
};

export function useSessionState(session: PaintSession | null): SessionState {
  const subscribe = useCallback((cb: () => void) => (session ? session.subscribe(() => cb()) : () => {}), [session]);
  return useSyncExternalStore(subscribe, () => (session ? session.getState() : EMPTY_STATE), () => EMPTY_STATE);
}

export function StoreProvider({ cat, children }: { cat: Catalogue; children: ReactNode }) {
  const shadeMap = useMemo(() => new Map(cat.shades.map((s) => [s.id, s])), [cat]);
  const [session, setSession] = useState<PaintSession | null>(null);
  const [favourites, setFavourites] = useState<string[]>(() => readJson<string[]>("cs-favourites", []).filter((id) => shadeMap.has(id)));
  const [recent, setRecent] = useState<string[]>(() => readJson<string[]>("cs-recent", []).filter((id) => shadeMap.has(id)));
  const [match, setMatch] = useState<MatchResult | null>(null);
  const isWide = useMedia("(min-width: 1024px)");

  useEffect(() => writeJson("cs-favourites", favourites), [favourites]);
  useEffect(() => writeJson("cs-recent", recent), [recent]);

  const value: Store = {
    cat,
    shade: (id) => shadeMap.get(id),
    session,
    setSession,
    favourites,
    toggleFavourite: (id) => setFavourites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [id, ...f])),
    recent,
    pushRecent: (id) => setRecent((r) => [id, ...r.filter((x) => x !== id)].slice(0, 12)),
    match,
    setMatch,
    isWide,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
