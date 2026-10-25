import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Catalogue, Product, Shade } from "../data/types";
import type { PaintSession, SessionState } from "../engine/session";
import type { Match, RGB } from "../engine/colour";
import { moneyFormatter } from "../lib/format";
import { readJson, writeJson } from "../lib/storage";
import type { Room } from "../lib/calc";

export type Tab = "paint" | "colours" | "calc" | "buy" | "saved";

export interface MatchResult {
  rgb: RGB;
  matches: Match<Shade>[];
}

interface Store {
  cat: Catalogue;
  money: (n: number) => string;
  shade: (id: string) => Shade | undefined;
  product: (id: string) => Product | undefined;
  session: PaintSession | null;
  setSession: (s: PaintSession | null) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  favourites: string[];
  toggleFavourite: (id: string) => void;
  recent: string[];
  pushRecent: (id: string) => void;
  rooms: Room[];
  setRooms: (r: Room[]) => void;
  orderQty: Record<string, { productId?: string; litres?: number }>;
  setOrderQty: (q: Record<string, { productId?: string; litres?: number }>) => void;
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

let roomSeq = 0;
export function newRoom(productId: string, name = "Living room"): Room {
  return { id: `r${Date.now().toString(36)}${roomSeq++}`, name, length: 4.5, width: 3.6, height: 2.7, doors: 1, windows: 1, coats: 2, ceiling: false, productId };
}

export function StoreProvider({ cat, children }: { cat: Catalogue; children: ReactNode }) {
  const money = useMemo(() => moneyFormatter(cat.brand.currency, cat.brand.locale), [cat]);
  const shadeMap = useMemo(() => new Map(cat.shades.map((s) => [s.id, s])), [cat]);
  const productMap = useMemo(() => new Map(cat.products.map((p) => [p.id, p])), [cat]);
  const [session, setSession] = useState<PaintSession | null>(null);
  const [tab, setTab] = useState<Tab>("paint");
  const [favourites, setFavourites] = useState<string[]>(() => readJson<string[]>("cs-favourites", []).filter((id) => shadeMap.has(id)));
  const [recent, setRecent] = useState<string[]>(() => readJson<string[]>("cs-recent", []).filter((id) => shadeMap.has(id)));
  const defaultProduct = cat.products.find((p) => p.use !== "exterior")?.id ?? cat.products[0]?.id ?? "";
  const [rooms, setRoomsState] = useState<Room[]>(() => {
    const saved = readJson<Room[]>("cs-rooms", []).filter((r) => productMap.has(r.productId));
    return saved.length ? saved : [newRoom(defaultProduct)];
  });
  const [orderQty, setOrderQtyState] = useState<Record<string, { productId?: string; litres?: number }>>({});
  const [match, setMatch] = useState<MatchResult | null>(null);
  const isWide = useMedia("(min-width: 1024px)");

  useEffect(() => writeJson("cs-favourites", favourites), [favourites]);
  useEffect(() => writeJson("cs-recent", recent), [recent]);
  useEffect(() => writeJson("cs-rooms", rooms), [rooms]);

  const value: Store = {
    cat,
    money,
    shade: (id) => shadeMap.get(id),
    product: (id) => productMap.get(id),
    session,
    setSession,
    tab,
    setTab,
    favourites,
    toggleFavourite: (id) => setFavourites((f) => (f.includes(id) ? f.filter((x) => x !== id) : [id, ...f])),
    recent,
    pushRecent: (id) => setRecent((r) => [id, ...r.filter((x) => x !== id)].slice(0, 12)),
    rooms,
    setRooms: setRoomsState,
    orderQty,
    setOrderQty: setOrderQtyState,
    match,
    setMatch,
    isWide,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
