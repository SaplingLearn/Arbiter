import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

// static-file.spec.ts IS NOT MODIFIED. This file covers what that one cannot see:
// it never opens the pre-flight panel and its network-attempt test never presses
// "?", so a rung 1 that fired on a served build and on file:// alike would leave it
// green. Task 10's review flagged the same gap on the unit side - preflight.test.tsx
// mocks interpret()/navigate() outright, so it proves what the panel REPORTS, never
// what postJson ACTUALLY does with real resolvers. This is the missing scenario:
// the panel opened with its real, unmocked resolvers, over file://, asserting zero
// network requests occur.
//
// Trap 3: assert on ATTEMPTED requests, not failed ones. A build that tries the
// call and fails is exactly as broken as one that succeeds - page.on("request")
// catches the attempt, requestfailed only catches the consequence, and a
// same-origin POST to /api/interpret over file:// may well produce neither a
// console error nor a visible defect while still being a request the ZIP made.
const artifact = pathToFileURL(path.resolve("apps/web/dist/index.html")).href;

test("opening the pre-flight panel runs both ladders and attempts NO request", async ({ page }) => {
  const attempted: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("file://")) attempted.push(`${r.method()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    attempted.push(`FAILED ${r.method()} ${r.url()} ${r.failure()?.errorText ?? ""}`);
  });

  // Measured, not assumed: with postJson's liveEnabled gate deliberately ablated
  // for a verification run, NEITHER "request" NOR "requestfailed" fired at all.
  // A relative "/api/interpret" resolves against a file:// document as
  // file:///api/interpret, and the Fetch API refuses the file: scheme outright,
  // synchronously, before any CDP network event exists to observe - the only
  // trace was a console error, "Fetch API cannot load file:///api/interpret. URL
  // scheme "file" is not supported." So the console channel is the one that
  // actually catches an ablated gate here; static-file.spec.ts's own first test
  // already treats a console error as a failure signal for the same reason.
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(`pageerror: ${String(e)}`));
  page.on("console", (m) => {
    if (m.type() === "error") failures.push(`console: ${m.text()}`);
  });

  await page.goto(`${artifact}#/case`);
  await expect(page.getByTestId("verdict")).toContainText(/abstain/i);

  // The panel runs interpret() and navigate() when it opens, so this is the whole
  // ladder for both surfaces executing on the artifact with its REAL resolvers -
  // nothing mocked, not a proxy for it.
  await page.keyboard.press("?");

  const surface1 = page.getByTestId("check-surface-1");
  const surface3 = page.getByTestId("check-surface-3");
  // NOT asserting "cache" specifically. Preflight.tsx's own comment on the probe
  // constants says they are "not asserted to hit any particular rung" - if the
  // authored cache drifts away from them the panel is meant to report a lower rung
  // and say so. Confirmed empirically: today's PROBE_CHALLENGE/PROBE_QUESTION land
  // both surfaces on rung 4 (source "local", keyword matching), not on cache -
  // see the task report for the measured values. What the zero-network guarantee
  // actually requires, and the only thing this test may pin, is that neither
  // ladder ever resolves to "live" and neither is left "pending" - i.e. both gates
  // held and both ladders ran to real completion.
  await expect(surface1).not.toHaveAttribute("data-source", "pending");
  await expect(surface3).not.toHaveAttribute("data-source", "pending");
  await expect(surface1).not.toHaveAttribute("data-source", "live");
  await expect(surface3).not.toHaveAttribute("data-source", "live");

  // Both gates held: the build flag is off in the submitted ZIP and location.protocol
  // is file:. Either one alone would be enough here, which is why both are tested
  // separately in the unit suite (client.test.ts); this asserts the observable
  // consequence of both holding together, in a real browser, which no unit test can.
  expect(attempted).toEqual([]);
  expect(failures).toEqual([]);
});

test("the evidence digest resolves over file://, so check-evidence-edits is a real check", async ({ page }) => {
  // Same reasoning as static-file.spec.ts's Web Crypto test: crypto.subtle is gated
  // on a secure context, and whether file:// counts is a browser policy decision.
  // The evidence digest is a second consumer of it, added this phase.
  await page.goto(`${artifact}#/case`);
  // Wait for the app to actually be interactive before dispatching a keyboard
  // event: static-file.spec.ts's equivalent test clicks a button first, which
  // Playwright auto-waits on; a bare keypress with nothing to wait on can be sent
  // before React has attached the "?" listener and is silently lost.
  await expect(page.getByTestId("verdict")).toContainText(/abstain/i);
  await page.keyboard.press("?");
  await expect(page.getByTestId("check-evidence-edits")).toHaveAttribute("data-ok", "true");
});
