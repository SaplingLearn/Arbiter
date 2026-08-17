import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, downloadReport } from "../src/api.js";

/**
 * A request that never settles leaves whatever awaits it pending forever, and every
 * screen here derives "busy" from exactly that. Killing the API under an open page
 * produces it: the dev proxy holds the socket rather than closing it.
 */
describe("request deadlines", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  const hangingFetch = (): void => {
    vi.stubGlobal("fetch", (_url: string, init: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => { reject(new DOMException("aborted", "AbortError")); });
    }));
  };

  it("fails a hung request as a timeout instead of hanging forever", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const pending = api.people("tok").then(() => "resolved").catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(60_000);
    const outcome = await pending;
    expect(outcome).toBeInstanceOf(ApiError);
    expect((outcome as ApiError).kind).toBe("timeout");
    expect((outcome as ApiError).status).toBe(504);
  });

  it("gives a summary the long deadline its measured 84 seconds needs", async () => {
    // The general timeout would kill a summary that was working perfectly. Asserted
    // by outliving it: at two minutes the request is still in flight.
    vi.useFakeTimers();
    hangingFetch();
    let settled = false;
    const pending = api.summarise("tok", "turalio").catch(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(181_000);
    await pending;
    expect(settled).toBe(true);
  });

  it("leaves a real error alone rather than reporting every failure as a timeout", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(api.people("tok")).rejects.toThrow(TypeError);
  });
});

/**
 * The report download. It does not go through `call`, because the body is a PDF and
 * the filename arrives in a header rather than in the body.
 */
describe("downloadReport", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  const answering = (init: { status?: number; body?: unknown; disposition?: string }): void => {
    const status = init.status ?? 200;
    vi.stubGlobal("fetch", () => Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h: string) => (h === "content-disposition" ? init.disposition ?? null : null) },
      blob: () => Promise.resolve(new Blob(["%PDF-1.4"], { type: "application/pdf" })),
      json: () => Promise.resolve(init.body ?? {}),
    }));
  };

  it("takes the filename the server chose", async () => {
    // Named on one side only. Rebuilding "arbiter-<compound>-<date>.pdf" here as well
    // would be the same string in two places, and a folder named two ways for one kind
    // of document is what that divergence looks like from the outside.
    answering({ disposition: 'attachment; filename="arbiter-turalio-2026-08-16.pdf"' });
    expect((await downloadReport("tok", "case_1")).filename).toBe("arbiter-turalio-2026-08-16.pdf");
  });

  it("refuses a filename with a path in it", async () => {
    // It becomes a name on somebody's disk. A response header is not a place to take
    // instructions about where a file lands.
    answering({ disposition: 'attachment; filename="../../evil.pdf"' });
    expect((await downloadReport("tok", "case_1")).filename).toBe("arbiter-report-case_1.pdf");
  });

  it("falls back when the server names nothing", async () => {
    answering({});
    expect((await downloadReport("tok", "case_1")).filename).toBe("arbiter-report-case_1.pdf");
  });

  it("surfaces the service's own refusal rather than a status code", async () => {
    // "This case has not been adjudicated" and "this deployment has no browser to
    // print with" are different problems with different fixes, and only the server
    // knows which one happened.
    answering({ status: 409, body: { error: "no_adjudication", detail: "This case is still open." } });
    const outcome = await downloadReport("tok", "case_1").catch((e: unknown) => e);
    expect(outcome).toBeInstanceOf(ApiError);
    expect((outcome as ApiError).kind).toBe("no_adjudication");
    expect((outcome as ApiError).message).toBe("This case is still open.");
  });

  it("reports a hung print as a timeout instead of hanging forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_url: string, init: { signal?: AbortSignal }) => new Promise((_r, reject) => {
      init.signal?.addEventListener("abort", () => { reject(new DOMException("aborted", "AbortError")); });
    }));
    const pending = downloadReport("tok", "case_1").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(61_000);
    expect((await pending as ApiError).kind).toBe("timeout");
  });
});
