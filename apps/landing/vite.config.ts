import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Deliberately NOT apps/web's config, for the same reason apps/deliberation is not.
 *
 * apps/web inlines every asset into one index.html because it is submitted as a file
 * the reader opens from disk, and `e2e/static-file.spec.ts` fails on an ATTEMPTED
 * subresource request. This page is the opposite case: it is a public page served over
 * http, and it asks for two webfonts from Google Fonts by design (BLUEPRINT names Inter
 * Tight and IBM Plex Mono specifically). Inlining would not make those requests go
 * away, so copying that plugin here would buy nothing and hide the difference.
 *
 * Port 5175 because apps/web takes Vite's default 5173 and apps/deliberation pins 5174;
 * all three are routinely open at once while comparing the marketing surface against
 * the product it describes.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    /**
     * `npm run dev` (tools/dev-all.mjs) runs this app as the single public entry
     * on port 5173 and mounts every other surface behind it, so the whole product
     * is one origin:
     *
     *   /app/          -> apps/web           (vite, internal port 5273)
     *   /deliberation/ -> apps/deliberation  (vite, internal port 5274)
     *   /api           -> services/api       (8787)
     *
     * `ws: true` carries the proxied apps' HMR websockets. Standalone
     * `landing:dev` still works on 5175; the proxies just 502 until their
     * targets are running, and nothing on this page requests them unprompted.
     */
    proxy: {
      "/app": { target: "http://127.0.0.1:5273", ws: true },
      "/deliberation": { target: "http://127.0.0.1:5274", ws: true },
      "/api": { target: `http://127.0.0.1:${process.env["API_PORT"] ?? 8787}`, changeOrigin: false },
    },
  },
  build: { outDir: "dist" },
});
