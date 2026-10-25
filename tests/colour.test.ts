import { describe, expect, it } from "vitest";
import { deltaE2000, hexToRgb, inkOn, isHex, lrvFromHex, matchLabel, nearestColours, rgbToHex, rgbToLab } from "../src/engine/colour";

describe("colour maths", () => {
  it("parses and formats hex", () => {
    expect(hexToRgb("#4B37BF")).toEqual([75, 55, 191]);
    expect(hexToRgb("fff")).toEqual([255, 255, 255]);
    expect(rgbToHex([75, 55, 191])).toBe("#4B37BF");
    expect(() => hexToRgb("#12")).toThrow();
    expect(isHex("#abc")).toBe(true);
    expect(isHex("zz1122")).toBe(false);
  });

  it("computes LRV at the extremes", () => {
    expect(lrvFromHex("#FFFFFF")).toBe(100);
    expect(lrvFromHex("#000000")).toBe(0);
    expect(lrvFromHex("#777777")).toBeGreaterThan(15);
    expect(lrvFromHex("#777777")).toBeLessThan(25);
  });

  it("matches the CIEDE2000 reference pairs (Sharma et al.)", () => {
    // Pairs 1, 7 and 17 from the published CIEDE2000 test data.
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(deltaE2000([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 3);
    expect(deltaE2000([50, 2.5, 0], [56, -27, -3])).toBeCloseTo(31.903, 2);
    expect(deltaE2000([60, 10, 10], [60, 10, 10])).toBe(0);
  });

  it("finds the nearest catalogue colour", () => {
    const items = [{ hex: "#FF0000", n: "red" }, { hex: "#00FF00", n: "green" }, { hex: "#0000FF", n: "blue" }];
    const m = nearestColours([250, 10, 12], items, 2);
    expect(m[0].item.n).toBe("red");
    expect(m).toHaveLength(2);
    expect(matchLabel(1)).toMatch(/Near-exact/);
    expect(matchLabel(20)).toMatch(/Nearest/);
  });

  it("picks readable ink", () => {
    expect(inkOn("#FFFFFF")).toBe("#1C1A24");
    expect(inkOn("#2F3E66")).toBe("#FFFFFF");
    expect(rgbToLab([255, 255, 255])[0]).toBeCloseTo(100, 0);
  });
});
