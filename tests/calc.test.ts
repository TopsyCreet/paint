import { describe, expect, it } from "vitest";
import { cheapestTins, describeTins, litresNeeded, totalsByProduct, wallArea, type Room } from "../src/lib/calc";
import type { Product } from "../src/data/types";

const matt: Product = { id: "matt", name: "Matt", finish: "matt", use: "interior", coverage: 12, sizes: [{ litres: 1, price: 6800 }, { litres: 4, price: 24500 }, { litres: 20, price: 108000 }] };

describe("paint calculator", () => {
  it("computes wall area minus openings", () => {
    const area = wallArea({ length: 4, width: 3, height: 2.5, doors: 1, windows: 2, ceiling: false });
    expect(area).toBeCloseTo(2 * 7 * 2.5 - 1.9 - 3, 5);
    expect(wallArea({ length: 4, width: 3, height: 2.5, doors: 0, windows: 0, ceiling: true })).toBeCloseTo(35 + 12, 5);
    expect(wallArea({ length: 1, width: 1, height: 1, doors: 5, windows: 5, ceiling: false })).toBe(0);
  });

  it("computes litres from coverage and coats", () => {
    expect(litresNeeded(60, 2, 12)).toBe(10);
    expect(litresNeeded(60, 2, 0)).toBe(0);
  });

  it("chooses the cheapest tin combination", () => {
    const plan = cheapestTins(10, matt.sizes);
    // 2 × 4 L + 2 × 1 L = 62,600 beats 3 × 4 L = 73,500
    expect(plan.litres).toBe(10);
    expect(plan.cost).toBe(62600);
    expect(describeTins(plan)).toBe("2 × 4 L + 2 × 1 L");
    expect(cheapestTins(0, matt.sizes).tins).toHaveLength(0);
    const big = cheapestTins(19, matt.sizes);
    expect(big.cost).toBeLessThanOrEqual(108000);
    expect(big.litres).toBeGreaterThanOrEqual(19);
  });

  it("totals rooms per product", () => {
    const rooms: Room[] = [
      { id: "a", name: "A", length: 4, width: 3, height: 2.5, doors: 0, windows: 0, coats: 2, ceiling: false, productId: "matt" },
      { id: "b", name: "B", length: 4, width: 3, height: 2.5, doors: 0, windows: 0, coats: 2, ceiling: false, productId: "matt" },
    ];
    const t = totalsByProduct(rooms, [matt]);
    expect(t).toHaveLength(1);
    expect(t[0].litres).toBeCloseTo((35 * 2 * 2) / 12, 5);
  });
});
