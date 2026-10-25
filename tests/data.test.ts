import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateCatalogue } from "../src/data/catalogue";
import type { Catalogue } from "../src/data/types";

const read = (f: string) => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url), "utf8"));

describe("shipped catalogue", () => {
  const shades = read("shades.json");
  const cat: Catalogue = { brand: read("brand.json"), families: shades.families, shades: shades.shades, products: read("products.json"), distributors: read("distributors.json") };

  it("has no validation errors", () => {
    const errors = validateCatalogue(cat).filter((i) => i.level === "error");
    expect(errors).toEqual([]);
  });

  it("covers the shade ids used by sample rooms", () => {
    const ids = new Set(cat.shades.map((s) => s.id));
    for (const id of ["okra-green", "lavender-gele", "lekki-sand"]) expect(ids.has(id)).toBe(true);
  });

  it("flags broken data", () => {
    const bad: Catalogue = { ...cat, shades: [{ id: "x", name: "", code: "", hex: "nope", family: "zzz" }], products: [] };
    const issues = validateCatalogue(bad);
    expect(issues.some((i) => i.message.includes("hex"))).toBe(true);
    expect(issues.some((i) => i.where === "Products")).toBe(true);
  });
});
