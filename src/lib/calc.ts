import type { Product, TinSize } from "../data/types";

/** Paint quantity maths. Pure and unit tested. */

export const DOOR_AREA = 1.9; // m², a standard 0.9 × 2.1 m door
export const WINDOW_AREA = 1.5; // m², a typical 1.2 × 1.2 m window

export interface Room {
  id: string;
  name: string;
  length: number;
  width: number;
  height: number;
  doors: number;
  windows: number;
  coats: number;
  ceiling: boolean;
  productId: string;
}

export function wallArea(r: Pick<Room, "length" | "width" | "height" | "doors" | "windows" | "ceiling">): number {
  const walls = 2 * (Math.max(0, r.length) + Math.max(0, r.width)) * Math.max(0, r.height);
  const openings = Math.max(0, r.doors) * DOOR_AREA + Math.max(0, r.windows) * WINDOW_AREA;
  const ceiling = r.ceiling ? Math.max(0, r.length) * Math.max(0, r.width) : 0;
  return Math.max(0, walls - openings) + ceiling;
}

export function litresNeeded(area: number, coats: number, coverage: number): number {
  if (coverage <= 0) return 0;
  return (Math.max(0, area) * Math.max(1, coats)) / coverage;
}

export interface TinPlan {
  tins: Array<{ size: TinSize; count: number }>;
  litres: number;
  cost: number;
}

/**
 * Cheapest combination of tins holding at least `litres`. Dynamic programming
 * over 0.5 L steps; ties go to the smaller total volume.
 */
export function cheapestTins(litres: number, sizes: TinSize[]): TinPlan {
  const valid = sizes.filter((s) => s.litres > 0 && s.price >= 0);
  if (litres <= 0 || !valid.length) return { tins: [], litres: 0, cost: 0 };
  const step = 0.5;
  const need = Math.ceil(litres / step - 1e-9);
  const maxTin = Math.max(...valid.map((s) => Math.round(s.litres / step)));
  const limit = need + maxTin;
  const cost = new Array<number>(limit + 1).fill(Infinity);
  const pick = new Array<number>(limit + 1).fill(-1);
  cost[0] = 0;
  for (let v = 1; v <= limit; v++) {
    for (let k = 0; k < valid.length; k++) {
      const u = Math.round(valid[k].litres / step);
      if (u <= v && cost[v - u] + valid[k].price < cost[v]) {
        cost[v] = cost[v - u] + valid[k].price;
        pick[v] = k;
      }
    }
  }
  let best = -1;
  for (let v = need; v <= limit; v++) if (cost[v] < Infinity && (best < 0 || cost[v] < cost[best])) best = v;
  if (best < 0) return { tins: [], litres: 0, cost: 0 };
  const counts = new Map<number, number>();
  for (let v = best; v > 0; v -= Math.round(valid[pick[v]].litres / step)) counts.set(pick[v], (counts.get(pick[v]) ?? 0) + 1);
  const tins = [...counts.entries()].map(([k, count]) => ({ size: valid[k], count })).sort((a, b) => b.size.litres - a.size.litres);
  return { tins, litres: best * step, cost: cost[best] };
}

export interface ProductTotal {
  product: Product;
  area: number;
  litres: number;
  plan: TinPlan;
}

/** Totals per product across all rooms. */
export function totalsByProduct(rooms: Room[], products: Product[]): ProductTotal[] {
  const map = new Map<string, { area: number; litres: number }>();
  for (const r of rooms) {
    const p = products.find((x) => x.id === r.productId);
    if (!p) continue;
    const area = wallArea(r);
    const cur = map.get(p.id) ?? { area: 0, litres: 0 };
    cur.area += area;
    cur.litres += litresNeeded(area, r.coats, p.coverage);
    map.set(p.id, cur);
  }
  return [...map.entries()].map(([id, v]) => {
    const product = products.find((x) => x.id === id)!;
    return { product, area: v.area, litres: v.litres, plan: cheapestTins(v.litres, product.sizes) };
  });
}

export function describeTins(plan: TinPlan): string {
  return plan.tins.map((t) => `${t.count} × ${t.size.litres} L`).join(" + ");
}
