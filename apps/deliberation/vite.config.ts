import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// ESM has no `__dirname`; this is the standard recovery, and it is why `resolve` is
// imported from node:path rather than reused from anything Vite exposes.
const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * Deliberately NOT apps/web's config.
 *
 * That app inlines everything into one `index.html` because it is submitted as a
 * file the reader opens from disk. This one is a CLIENT FOR A SERVICE: without the
 * API there is nothing to show, so a self-contained bundle would be a page that
 * loads and cannot do anything. Copying the inlining plugin here would have
 * produced exactly that, and it would have looked like it worked.
 *
 * `/api` proxies to the deliberation server so the browser makes same-origin
 * requests and no CORS configuration exists to get wrong.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /* `/r/:caseId/:token` is a real path, not a hash route, because it is what a QR code
       carries and what somebody pastes into a chat. In dev Vite must be told which HTML
       answers it. In production `services/api/server.ts` answers it out of the built site,
       and `tools/stage-site.mjs` puts the document where that server looks - see both.
       Rewriting `req.url` rather than adding a second `server.proxy` entry, because Vite's
       own middleware - the part that turns `public.html`'s `<script src="/src/public.tsx">`
       into a served module - only runs for requests it recognises as HTML, and it
       recognises them by path, not by content negotiation.

       PREFIXED WITH THE SERVER'S OWN BASE, which is not decoration. `npm run dev` starts
       this app with `--base /deliberation/` (tools/dev-all.mjs) so it can sit behind the
       landing app's proxy, and under a base Vite resolves every path it serves - including
       which HTML entry a request names - against that prefix. Rewriting to a bare
       `/public.html` there names nothing, so the unified dev server answered a share link
       with a 404 while `npm run deliberate:dev`, whose base is `/`, worked perfectly. One
       arrangement working and the other not is the shape of a hardcoded prefix; `base`
       already holds the right answer for both. */
    {
      name: "arbiter-public-report",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url?.startsWith("/r/") === true) req.url = `${server.config.base}public.html`;
          next();
        });
      },
    },
  ],
  /**
   * Relative, so the bundle works wherever it is mounted - at the root, or under
   * the /app/ subpath apps/landing links to. The default "/" would emit absolute
   * /assets/... references that collide with the landing page's own /assets/ when
   * the two are served from one host, which is the arrangement spec 10 describes.
   *
   * Safe with this app's hash routing: every route is a fragment, so the document
   * is always index.html and a relative asset path never resolves against a
   * deeper directory. apps/web sets the same thing for its own reason.
   *
   * NOT SAFE FOR public.html, which `/r/:caseId/:token` serves two real path
   * segments deep - a relative reference from that document would resolve against
   * `/r/<caseId>/` and 404. The first fix tried was `<base href="/">` on that one
   * document, and it was wrong in a way that mattered more than the 404: a `<base>`
   * override changes the resolution target of EVERY relative URL on the page, not
   * just the ones this config controls, and `report.tsx` prints several - "Back to
   * the verdict", the sheet pager - as fragment-only hrefs. Those normally resolve
   * against the current URL, so clicking one is an ordinary hash change. Under a
   * `<base href="/">` they resolve against `/` instead, which is a DIFFERENT path
   * than `/r/<caseId>/<token>` - so the browser does a real navigation, off the
   * public page and onto whatever answers `/`. On a built site that is the landing
   * page, and one directory along at `/deliberation/` is `index.html` - which on a
   * build made with VITE_AUTO_EMAIL and VITE_AUTO_PASSWORD signs its visitor in.
   * One stray link would have walked an anonymous reader out of the record and, on
   * such a build, into a session. `renderBuiltUrl` below fixes the same 404 by
   * rewriting only the ASSET references this build controls, and touches nothing
   * already on the page.
   */
  base: "./",
  experimental: {
    /**
     * Only public.html's OWN references get rewritten to an absolute path; index.html's
     * stay relative, unchanged, for the subpath-mounting reason above. `hostId` is the
     * HTML file doing the referencing - Vite calls this for every `<script>`/`<link>`
     * it injects into an entry, as well as for assets imported from JS - so this checks
     * which entry is asking rather than assuming every HTML file wants the same answer.
     * Returning `undefined` for everything else falls through to the default `base`
     * behaviour untouched.
     *
     * ABSOLUTE FROM WHERE, THOUGH. This emits `/assets/...`, which is correct for a build
     * served at the root - `apps/deliberation/dist` opened directly - and wrong for one
     * staged under a subpath, where those references point into the LANDING page's own
     * assets directory and 404. This function cannot know the difference: the destination
     * is `apps/landing/src/links.ts`'s APP_URL, read at STAGING time, and a build that
     * guessed it would be the same drifting literal `tools/stage-site.mjs` exists not to
     * repeat. So that script re-points them, having just staged the directory they should
     * name, and fails the build if any of them does not resolve. What has to survive here
     * is only that they stay ABSOLUTE - a relative reference from `/r/<caseId>/<token>` is
     * the 404 this override was written for, and no amount of restaging fixes it.
     */
    renderBuiltUrl(filename, { hostId, hostType }) {
      if (hostType === "html" && hostId === "public.html") return `/${filename}`;
      return undefined;
    },
  },
  server: {
    port: 5174,
    // Bound to the IPv4 loopback explicitly. Left to itself Vite binds ::1 only, and
    // Chrome resolves 127.0.0.1 first — so the landing page's LOGIN button, which points
    // here, fails with a refused connection while the dev server sits there looking
    // perfectly healthy in the terminal. `apps/atmosphere` and `apps/landing` both carry
    // the same pin for the same reason; this was the last app missing it.
    host: "127.0.0.1",
    proxy: { "/api": { target: `http://127.0.0.1:${process.env["API_PORT"] ?? 8787}`, changeOrigin: false } },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        // Two entries, two bundles. The public one must not contain the app shell -
        // see the note at the top of src/public.tsx.
        main: resolve(__dirname, "index.html"),
        public: resolve(__dirname, "public.html"),
      },
    },
  },
});
