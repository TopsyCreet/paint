import { describe, expect, it } from "vitest";
import { csvToObjects, parseCsv, slugify, toCsv } from "../src/lib/csv";
import { inAppBrowser, cameraHelp } from "../src/lib/camera";

describe("csv", () => {
  it("parses quotes, commas and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
    expect(csvToObjects("Name,Hex Code\nOkra,#8E9B6E")).toEqual([{ name: "Okra", hex_code: "#8E9B6E" }]);
    expect(toCsv([["a", 'b"c'], [1, "x,y"]])).toBe('a,"b""c"\n1,"x,y"');
    expect(slugify("Aso-Ebi Plum & Gold")).toBe("aso-ebi-plum-and-gold");
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
