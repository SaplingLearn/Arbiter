import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * A PUBLISHED RECORD, OPENED FROM ITS SHARE LINK, AGAINST A BUILT SITE.
 *
 * This is the one test in the repo that can see the gap this feature shipped with. Every
 * other suite passes with `/r/:caseId/:token` completely unreachable: the unit tests drive
 * `makeHandler` over a temporary directory, `apps/deliberation/test/public.test.tsx` renders
 * `PublicReport` with props, and `e2e/one-origin.spec.ts` drives the Vite dev server, whose
 * own middleware has always answered `/r/*`. What none of them exercises is the arrangement
 * a scanned QR code actually meets - a real `npm run site:build` output, served by
 * `services/api` with `ARBITER_STATIC_DIR` set - which is where the two halves of the
 * feature were wired to different answers.
 *
 * THE ASSERTION THAT MATTERS IS THE ONE ABOUT FAILED REQUESTS, not the one about text. The
 * failure this guards against was not a 404 on the page. It was `public.html` served with
 * status 200 and a correct content type from a mount where its root-absolute
 * `/assets/public-<hash>.js` did not exist - a document that parses, a status line that
 * says everything is fine, and a blank white page. A test that only asserted on rendered
 * content would have caught that one too, but by timeout rather than by cause; a test that
 * asserted the status code would have passed. Both are recorded below.
 *
 * NOTHING HERE CAN SPEND MONEY. `playwright.config.ts` starts this project's server with
 * every model credential blanked, which makes `buildComplete` return null for both
 * providers `providerFor` can name - so `/adjudicate` takes `stubComplete`, which is free,
 * offline and deterministic. The `source: "stub"` assertion below is the guard on that: if
 * a credential ever reaches this server the test fails rather than quietly billing three
 * calls per run.
 */

const OWNER = "r.okafor@arbiter.demo";
const PANEL = ["a.silva@arbiter.demo", "b.mehta@arbiter.demo"];
/** `seed-demo.ts` publishes this, and says why in as many words. */
const PASSWORD = "arbiter-demo-2026";

/** The two findings a position can cite. Explicit rather than opened through
 *  `POST /api/demo`, which transcribes a real regulatory review off disk: that path costs
 *  about 1.4s and produces finding ids this spec would then have to discover. */
const FINDINGS = [
  { id: "f-hep", label: "Human hepatocyte", assertion: "toxic", detail: "Signal at 10uM.", covers: ["M1"] },
  { id: "f-rat", label: "Rat 28-day", assertion: "safe", detail: "Clean at 3x.", covers: ["M5"] },
];

const AT = "2026-08-17T09:00:00Z";

interface Session { token: string; id: string }

async function signIn(request: APIRequestContext, email: string): Promise<Session> {
  const res = await request.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(
    res.status(),
    `Could not sign in as ${email}. This suite needs the demonstration team; `
    + `playwright.config.ts runs \`npm run seed:demo\` before the server, so a failure here `
    + `means that step did not run or the store holds a different password.`,
  ).toBe(200);
  const body = await res.json() as { token: string; user: { id: string } };
  return { token: body.token, id: body.user.id };
}

function auth(s: Session): { headers: Record<string, string> } {
  return { headers: { authorization: `Bearer ${s.token}` } };
}

/**
 * Publish a fresh adjudicated case and return its share URL.
 *
 * A NEW CASE ID PER RUN. The server writes to `results/deliberation-log.jsonl`, which is
 * whatever the machine already had - a developer's own store locally, an empty one in CI.
 * A fixed id would collide with the previous run's case on the second invocation and fail
 * at creation for a reason that has nothing to do with what this file tests.
 */
async function publishARecord(request: APIRequestContext): Promise<{ url: string; caseId: string }> {
  const owner = await signIn(request, OWNER);
  const panel = [];
  for (const email of PANEL) panel.push(await signIn(request, email));

  const caseId = `e2e-share-${String(process.pid)}-${String(Math.floor(performance.now()))}`;
  const created = await request.post("/api/cases", {
    ...auth(owner),
    data: {
      caseId,
      compoundLabel: "TAK-994",
      context: "Chronic dosing, e2e.",
      participantIds: panel.map((p) => p.id),
      findings: FINDINGS,
      at: AT,
    },
  });
  expect(created.status(), await created.text()).toBe(201);

  for (const p of panel) {
    const submitted = await request.post(`/api/cases/${caseId}/positions`, {
      ...auth(p),
      data: {
        call: "advance",
        reasoning: "The human signal has no exposure margin behind it.",
        citedFindingIds: ["f-hep"],
        external: [],
        submittedAt: AT,
      },
    });
    expect(submitted.status(), await submitted.text()).toBe(201);
  }

  expect((await request.post(`/api/cases/${caseId}/reveal`, {
    ...auth(owner), data: { mode: "all_in", at: AT },
  })).status()).toBe(200);

  const adjudicated = await request.post(`/api/cases/${caseId}/adjudicate`, {
    ...auth(owner), data: { at: AT },
  });
  expect(adjudicated.status(), await adjudicated.text()).toBe(200);
  // THE SPEND GUARD. Stub means no credential reached this server, which is what
  // playwright.config.ts arranges and what keeps this suite free to run.
  expect(
    (await adjudicated.json() as { source: string }).source,
    "The adjudicator answered LIVE, so this run spent three model calls. "
    + "playwright.config.ts blanks every model credential for this server; one of them got through.",
  ).toBe("stub");

  const published = await request.post(`/api/cases/${caseId}/share`, { ...auth(owner), data: {} });
  expect(
    published.status(),
    "Publishing needs ARBITER_SHARE_SECRET; 501 here means playwright.config.ts did not set it.",
  ).toBe(201);

  const { url } = await published.json() as { url: string };
  // Built by the server from the request's own Host header, so it points back at the
  // origin this suite is driving. Asserted rather than assumed, because a proxy-shaped
  // deployment could make it point elsewhere and the goto below would then be testing
  // nothing.
  expect(url).toContain(`/r/${caseId}/`);
  return { url, caseId };
}

test("a published record opens from its share link on a built site", async ({ page, request }) => {
  const { url } = await publishARecord(request);

  /**
   * EVERY FAILED SUBRESOURCE, COLLECTED. This is the assertion the task exists for: the
   * document was already being served correctly at the moment the page was blank, and the
   * only evidence anywhere was a 404 in a console nobody was reading.
   */
  const failed: string[] = [];
  page.on("response", (res) => {
    if (res.status() >= 400) failed.push(`${String(res.status())} ${res.url()}`);
  });

  const response = await page.goto(url);
  expect(response?.status()).toBe(200);

  await expect(page).toHaveTitle(/Deliberation record/i);

  /**
   * ASSERTED BEFORE THE CONTENT, and the order is the difference between a test that
   * catches the defect and a test that reports the weather.
   *
   * Measured, by reintroducing the defect: with the content check first, this fails as
   * `getByText("TAK-994") … element(s) not found` after a five-second timeout - the
   * symptom, five seconds late, naming a compound instead of a cause. With this check
   * first it fails as `404 …/assets/public-<hash>.js`, immediately, naming the file that
   * was not found and therefore the mount that was wrong.
   *
   * `waitForLoadState` because the script tag is discovered during parsing but its
   * failure arrives after `goto` resolves; without it this races the network and passes
   * on an empty list.
   */
  await page.waitForLoadState("networkidle");
  expect(failed, `The document was served but ${String(failed.length)} request(s) failed:\n${failed.join("\n")}`).toEqual([]);

  // Real content, not merely a non-empty body: the blank page had a body, a title and a
  // root element. Only the record proves the bundle ran.
  await expect(page.getByText("TAK-994").first()).toBeVisible();
});

/**
 * THE SHARE LINK IS NOT A WAY INTO THE PRODUCT, and that is the property the whole feature
 * rests on. The public entry is a separate bundle for this reason - see the note at the top
 * of `apps/deliberation/src/public.tsx` - but "the bundle contains no auth code" is proved
 * by a grep over the chunks, while this proves the SERVED page is that bundle and not the
 * app shell. A rewrite that fell back to `index.html` would satisfy every other assertion
 * in this file.
 */
test("the share link serves the record and not the app shell", async ({ page, request }) => {
  const { url } = await publishARecord(request);
  await page.goto(url);

  await expect(page.getByText("TAK-994").first()).toBeVisible();
  // The shell's landmark, rendered only once a session exists. Its absence is the point.
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  // And no way to walk from here into anything. `public.test.tsx` asserts the rendered
  // page has zero anchors; this checks the same claim against the built bundle.
  await expect(page.locator("a")).toHaveCount(0);
});

/**
 * A link that does not verify, against a BUILT site. The page still has to load - the HTML
 * and its bundle are the same for every visitor, because the token is checked by the API
 * and not by the static server - and then say one thing for every cause.
 */
test("a token that does not verify loads the page and refuses to explain", async ({ page, request }) => {
  const { caseId } = await publishARecord(request);

  const failed: string[] = [];
  page.on("response", (res) => {
    // The record fetch itself is EXPECTED to 404 here; that is what is being tested. Any
    // other failure is the blank-page defect wearing a different hat.
    if (res.status() >= 400 && !res.url().includes("/api/public/report/")) {
      failed.push(`${String(res.status())} ${res.url()}`);
    }
  });

  const response = await page.goto(`/r/${caseId}/not-the-token`);
  expect(response?.status()).toBe(200);

  await expect(page.getByText(/This link is not valid/i)).toBeVisible();
  // Not "revoked", not "no such case" - the uniform refusal the API's 404 exists to keep.
  await expect(page.getByText(/revoked|does not exist|expired/i)).toHaveCount(0);
  expect(failed, failed.join("\n")).toEqual([]);
});

/**
 * The shapes under `/r` that are not whole share links. 404 rather than the record page,
 * and specifically rather than the landing page - `serveStatic` has no fallback and this is
 * what says so from outside.
 */
test("a truncated share URL 404s instead of answering with a page", async ({ page }) => {
  for (const path of ["/r", "/r/", "/r/only-one-segment"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
});
