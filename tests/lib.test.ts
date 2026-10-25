import { describe, expect, it } from "vitest";
import { csvToObjects, parseCsv, slugify, toCsv } from "../src/lib/csv";
import { distanceKm, formatKm, sortByDistance } from "../src/lib/geo";
import { orderMessage, whatsappUrl } from "../src/lib/order";
import { inAppBrowser, cameraHelp } from "../src/lib/camera";
import { cheapestTins } from "../src/lib/calc";

describe("csv", () => {
  it("parses quotes, commas and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
    expect(csvToObjects("Name,Hex Code\nOkra,#8E9B6E")).toEqual([{ name: "Okra", hex_code: "#8E9B6E" }]);
    expect(toCsv([["a", 'b"c'], [1, "x,y"]])).toBe('a,"b""c"\n1,"x,y"');
    expect(slugify("Aso-Ebi Plum & Gold")).toBe("aso-ebi-plum-and-gold");
  });
});

describe("geo", () => {
  it("measures Lagos to Abuja", () => {
    const km = distanceKm({ lat: 6.5244, lng: 3.3792 }, { lat: 9.0765, lng: 7.3986 });
    expect(km).toBeGreaterThan(510);
    expect(km).toBeLessThan(540);
    expect(formatKm(0.4)).toBe("under 1 km");
    expect(formatKm(3.25)).toBe("3.3 km");
    const sorted = sortByDistance([{ lat: 9, lng: 7, n: "far" }, { lat: 6.5, lng: 3.4, n: "near" }], { lat: 6.52, lng: 3.38 });
    expect(sorted[0].n).toBe("near");
  });
});

describe("order", () => {
  it("builds a WhatsApp order", () => {
    const text = orderMessage({
      distributor: { id: "d", name: "Allen Paints", address: "", city: "Ikeja", state: "Lagos", lat: 0, lng: 0 },
      lines: [{ shade: { id: "s", name: "Okra Green", code: "CS-501", hex: "#8E9B6E", family: "green" }, product: { id: "m", name: "Matt", finish: "matt", use: "interior", coverage: 12, sizes: [{ litres: 4, price: 1000 }] }, litres: 4, plan: cheapestTins(4, [{ litres: 4, price: 1000 }]) }],
      customerArea: "Ikeja, Lagos",
      brandName: "Colour Studio",
      money: (n) => `₦${n}`,
    });
    expect(text).toContain("Hello Allen Paints");
    expect(text).toContain("Matt in Okra Green (CS-501): 1 × 4 L (about ₦1000)");
    expect(text).toContain("I'm in Ikeja, Lagos");
    expect(whatsappUrl("hi there", "+234 801 234 5678")).toBe("https://wa.me/2348012345678?text=hi%20there");
    expect(whatsappUrl("x")).toBe("https://wa.me/?text=x");
  });
});

describe("camera help", () => {
  it("detects in-app browsers", () => {
    expect(inAppBrowser("Mozilla/5.0 (Linux; Android 13) ... WhatsApp/2.24")).toBe("WhatsApp");
    expect(inAppBrowser("Mozilla/5.0 ... Instagram 300.0")).toBe("Instagram");
    expect(inAppBrowser("Mozilla/5.0 ... [FBAN/FBIOS;FBAV/450]")).toBe("Facebook");
    expect(inAppBrowser("Mozilla/5.0 (Linux; Android 14; SM-A145F) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36")).toBeNull();
    expect(cameraHelp("in-app", "WhatsApp").body).toMatch(/Open in Chrome/);
    expect(cameraHelp("denied").title).toMatch(/permission/i);
  });
});
