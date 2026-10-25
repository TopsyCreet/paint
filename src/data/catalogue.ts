import type { Brand, Catalogue, Distributor, Family, Product, Shade } from "./types";
import { isHex } from "../engine/colour";
import { readJson } from "../lib/storage";

export const DRAFT_KEY = "cs-admin-draft";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(new URL(path, document.baseURI).href, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Couldn't load ${path} (${res.status}).`);
  return (await res.json()) as T;
}

/** Loads the catalogue from public/data. `?preview=1` uses the admin tool's unsaved draft. */
export async function loadCatalogue(): Promise<Catalogue> {
  if (new URLSearchParams(location.search).get("preview") === "1") {
    const draft = readJson<Catalogue | null>(DRAFT_KEY, null);
    if (draft && draft.shades?.length) return draft;
  }
  const [brand, shadeFile, products, distributors] = await Promise.all([
    getJson<Brand>("data/brand.json"),
    getJson<{ families: Family[]; shades: Shade[] }>("data/shades.json"),
    getJson<Product[]>("data/products.json"),
    getJson<Distributor[]>("data/distributors.json"),
  ]);
  return { brand, families: shadeFile.families, shades: shadeFile.shades, products, distributors };
}

export interface Issue {
  level: "error" | "warning";
  where: string;
  message: string;
}

/** Checks a catalogue for problems the app can't recover from, and likely mistakes. */
export function validateCatalogue(c: Catalogue): Issue[] {
  const out: Issue[] = [];
  const err = (where: string, message: string) => out.push({ level: "error", where, message });
  const warn = (where: string, message: string) => out.push({ level: "warning", where, message });
  if (!c.brand?.name) err("Brand", "Brand name is missing.");
  if (c.brand?.colours && !isHex(c.brand.colours.primary)) err("Brand", "Primary colour must be a hex value like #4B37BF.");
  if (!c.shades.length) err("Shades", "Add at least one shade.");
  const famIds = new Set(c.families.map((f) => f.id));
  const ids = new Set<string>(), codes = new Set<string>();
  c.shades.forEach((s, i) => {
    const where = `Shade ${i + 1}${s.name ? ` (${s.name})` : ""}`;
    if (!s.id) err(where, "Missing id.");
    else if (ids.has(s.id)) err(where, `Duplicate id "${s.id}".`);
    ids.add(s.id);
    if (!s.name) err(where, "Missing name.");
    if (!s.hex || !isHex(s.hex)) err(where, `Colour "${s.hex ?? ""}" is not a valid hex value.`);
    if (s.code && codes.has(s.code)) warn(where, `Code "${s.code}" is used more than once.`);
    if (s.code) codes.add(s.code);
    if (!famIds.has(s.family)) warn(where, `Family "${s.family}" isn't in the families list.`);
  });
  if (!c.products.length) err("Products", "Add at least one product.");
  c.products.forEach((p, i) => {
    const where = `Product ${i + 1}${p.name ? ` (${p.name})` : ""}`;
    if (!p.id) err(where, "Missing id.");
    if (!(p.coverage > 0)) err(where, "Coverage must be more than 0 m² per litre.");
    if (!p.sizes?.length) err(where, "Add at least one tin size.");
    p.sizes?.forEach((s) => { if (!(s.litres > 0)) err(where, "Tin sizes must be more than 0 litres."); });
  });
  c.distributors.forEach((d, i) => {
    const where = `Distributor ${i + 1}${d.name ? ` (${d.name})` : ""}`;
    if (!d.name) err(where, "Missing name.");
    if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng) || Math.abs(d.lat) > 90 || Math.abs(d.lng) > 180) err(where, "Latitude and longitude are missing or out of range.");
    if (d.whatsapp && !/^\d{10,15}$/.test(d.whatsapp)) warn(where, "WhatsApp number should be digits in international format, e.g. 2348012345678.");
  });
  return out;
}
