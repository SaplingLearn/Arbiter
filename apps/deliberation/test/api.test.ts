import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../src/api.js";

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

  /**
   * THE ONE CALL THAT RELIABLY OUTLASTS A MINUTE, and it was on the minute deadline.
   *
   * `consensus.ts` runs the adjudication three times sequentially and takes the
   * majority, because the verdict is not deterministic at temperature 0. Measured at
   * 102 seconds on the tucatinib case - so the client aborted at 60, told the reader
   * the service might be restarting, and the server went on finishing the adjudication
   * behind a closed socket. Asserted by outliving the general deadline AND the measured
   * duration, rather than by reading the constant back.
   */
  it("gives the adjudication a deadline its three sequential runs can finish inside", async () => {
    vi.useFakeTimers();
    hangingFetch();
    let settled = false;
    const pending = api.adjudicate("tok", "c1", "2026-08-18T00:00:00Z").catch(() => { settled = true; });

    // Past the general 60s deadline and past the 102s the three runs were measured at.
    await vi.advanceTimersByTimeAsync(150_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(151_000);
    await pending;
    expect(settled).toBe(true);
  });

  it("leaves a real error alone rather than reporting every failure as a timeout", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(api.people("tok")).rejects.toThrow(TypeError);
  });
});

describe("the printable record", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("surfaces the service's own refusal rather than a status code", async () => {
    // "This case is still open" tells the reader what to do. "Something went wrong"
    // sends them to whoever built it.
    vi.stubGlobal("fetch", () => Promise.resolve({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: "no_adjudication", detail: "This case is still open." }),
    }));
    const outcome = await api.report("tok", "case_1").catch((e: unknown) => e);
    expect(outcome).toBeInstanceOf(ApiError);
    expect((outcome as ApiError).kind).toBe("no_adjudication");
    expect((outcome as ApiError).message).toBe("This case is still open.");
  });
});
