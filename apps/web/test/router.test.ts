import { describe, expect, it } from "vitest";
import { parseHash, TAB_IDS } from "../src/router.js";

describe("parseHash", () => {
  it("reads each known tab", () => {
    for (const t of TAB_IDS) expect(parseHash(`#/${t}`)).toBe(t);
  });

  it("defaults to the case tab for anything unrecognised", () => {
    // The demo opens on the case. An unknown fragment must never blank the app.
    for (const h of ["", "#", "#/", "#/nope", "garbage"]) expect(parseHash(h)).toBe("case");
  });

  it("ignores a trailing slash and query noise", () => {
    expect(parseHash("#/validation/")).toBe("validation");
    expect(parseHash("#/record?x=1")).toBe("record");
  });
});
