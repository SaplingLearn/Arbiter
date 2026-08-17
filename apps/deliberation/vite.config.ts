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
       answers it; in production the API's static handler does the same job (server.ts,
       `serveStatic`). Rewriting `req.url` rather than adding a second `server.proxy`
       entry, because Vite's own middleware - the part that turns `public.html`'s
       `<script src="/src/public.tsx">` into a served module - only runs for requests it
       recognises as HTML, and it recognises them by path, not by content negotiation. */
    {
      name: "arbiter-public-report",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url?.startsWith("/r/") === true) req.url = "/public.html";
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
   * NOT SAFE FOR public.html, which is why that file overrides it with its own
   * `<base href="/">`. `/r/:caseId/:token` is two real path segments deep, so a
   * relative reference from that document would resolve against `/r/<caseId>/`
   * and 404 - the fragment trick above does not apply to a document that is not
   * always served from the same shallow path.
   */
  base: "./",
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
