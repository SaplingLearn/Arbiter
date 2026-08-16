import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
  plugins: [react(), tailwindcss()],
  /**
   * Relative, so the bundle works wherever it is mounted - at the root, or under
   * the /app/ subpath apps/landing links to. The default "/" would emit absolute
   * /assets/... references that collide with the landing page's own /assets/ when
   * the two are served from one host, which is the arrangement spec 10 describes.
   *
   * Safe with this app's hash routing: every route is a fragment, so the document
   * is always index.html and a relative asset path never resolves against a
   * deeper directory. apps/web sets the same thing for its own reason.
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
  build: { outDir: "dist" },
});
