import { describe, expect, it } from "vitest";
import { lastJsonObject } from "../documents.js";

/**
 * The regression this file exists for.
 *
 * PyMuPDF 1.26 started printing a deprecation banner to STDOUT when imported as `fitz`.
 * `measure_pdf.py` communicates by printing one JSON object to stdout, and the Node side
 * did `JSON.parse(stdout)`. So the banner landed in front of the payload, the parse threw,
 * and `measurePdf` reported EVERY upload of EVERY document as unreadable - with a message
 * about the measurer, which is not where anybody would look.
 *
 * The import is fixed in the Python. This holds the boundary, because the next library to
 * print a line on stdout should not be able to refuse every document again.
 */
const BANNER = "warning: The `fitz` API is deprecated and will be removed in future. Use `import pymupdf` instead.\n";
const PAYLOAD = { ok: true, verdict: "readable", pages: 288, charactersPerPage: 2197 };

describe("lastJsonObject", () => {
  it("reads a clean payload", () => {
    expect(lastJsonObject(JSON.stringify(PAYLOAD))).toEqual(PAYLOAD);
  });

  it("reads the payload out from behind the exact banner that broke it", () => {
    expect(lastJsonObject(BANNER + JSON.stringify(PAYLOAD))).toEqual(PAYLOAD);
  });

  it("survives several lines of preamble", () => {
    const noise = `${BANNER}some other library: loading tables\n\n`;
    expect(lastJsonObject(noise + JSON.stringify(PAYLOAD))).toEqual(PAYLOAD);
  });

  it("is not fooled by a brace inside the preamble", () => {
    // A warning that mentions a dict, or prints a partial object, must not be mistaken
    // for the payload.
    const noise = 'warning: config {"mode": "fast"} was ignored\n';
    expect(lastJsonObject(noise + JSON.stringify(PAYLOAD))).toEqual(PAYLOAD);
  });

  it("reads a payload containing nested objects", () => {
    const nested = { ...PAYLOAD, termCounts: { toxicology: { hepat: 4 }, liver: { ALT: 9 } } };
    expect(lastJsonObject(BANNER + JSON.stringify(nested))).toEqual(nested);
  });

  it("returns null when there is no object at all, rather than guessing", () => {
    // A measurement that could not run is NOT a pass - the caller turns this into a
    // refusal, which is the behaviour that must survive.
    expect(lastJsonObject("")).toBeNull();
    expect(lastJsonObject("Traceback (most recent call last):\n  File ...\n")).toBeNull();
  });
});
