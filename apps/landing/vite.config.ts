import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * This app is the PUBLIC ENTRY for the whole product, and the only surface a
 * reader reaches by typing a bare address.
 *
 * It is a public page served over http, and it asks for two webfonts from Google
 * Fonts by design (BLUEPRINT names Inter Tight and IBM Plex Mono specifically), so
 * it neither inlines its assets nor pretends it can be opened from a filesystem.
 *
 * Port 5175 is the STANDALONE port, for `npm run landing:dev` when you want this
 * page on its own. Under `npm run dev` (tools/dev-all.mjs) the same app is started
 * on the public port instead, with the flag overriding this value.
 *
 * TAILWIND IS v4, so there is no `tailwind.config.js` and no PostCSS entry to look for.
 * v4 configures itself from CSS — the tokens live in an `@theme` block in `shell.css`
 * — and the Vite plugin below is the whole build integration. Anyone arriving from a v3
 * project will go looking for a config file that is deliberately not there.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5175,
    // Bound to the IPv4 loopback explicitly. Left to itself Vite binds ::1 only, and
    // both Playwright and Chrome resolve 127.0.0.1 first — the failure looks like a
    // dead server while curl on `localhost` happily succeeds. `apps/atmosphere` hit
    // this first and carries the same pin for the same reason.
    host: "127.0.0.1",
    /**
     * `npm run dev` (tools/dev-all.mjs) runs this app as the single public entry
     * and mounts every other surface behind it, so the whole product is one
     * origin and the browser never makes a cross-origin request:
     *
     *   /deliberation/ -> apps/deliberation  (vite, internal port 5274)
     *   /api           -> services/api       (8787)
     *
     * `ws: true` carries the proxied app's HMR websocket - without it the
     * deliberation client loads through the proxy but never hot-reloads, which
     * looks like a broken dev server rather than a missing flag.
     *
     * Standalone `landing:dev` still works; the proxies just 502 until their
     * targets are running, and nothing on this page requests them unprompted.
     */
    proxy: {
      "/deliberation": { target: "http://127.0.0.1:5274", ws: true },
      "/api": { target: `http://127.0.0.1:${process.env["API_PORT"] ?? 8787}`, changeOrigin: false },
    },
  },
  build: { outDir: "dist" },
});
