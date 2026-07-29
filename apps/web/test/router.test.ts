import { describe, expect, it } from "vitest";
import { parseHash, TAB_IDS } from "../src/router.js";

describe("parseHash", () => {
  it("reads each known tab", () => {
    for (const t of TAB_IDS) expect(parseHash(`#/${t}`)).toBe(t);
  });

  it("opens on the landing page when there is no fragment at all", () => {
    // A first load - the artifact double-clicked out of the ZIP - has no
    // fragment, and someone in that position has never seen the tool. "#" and
    // "#/" are the same state: browsers report them as an empty hash or as a
    // bare root, and neither names a tab.
    for (const h of ["", "#", "#/"]) expect(parseHash(h)).toBe("about");
  });

  it("falls back to the case, NOT the landing page, for anything unrecognised", () => {
    // The other half of the pair, and the reason this test exists: a mistyped or
    // stale fragment mid-demo must land on the worked case, not on the page that
    // explains what ARBITER is. Both directions are pinned because the obvious
    // implementation - treat everything unknown as a first load - would pass the
    // test above and get this one wrong.
    for (const h of ["#/nope", "#/about-us", "garbage", "#/ABOUT"]) {
      expect(parseHash(h)).toBe("case");
    }
  });

  it("ignores a trailing slash and query noise", () => {
    expect(parseHash("#/validation/")).toBe("validation");
    expect(parseHash("#/record?x=1")).toBe("record");
    expect(parseHash("#/about/")).toBe("about");
  });
});
