import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { "/api": { target: `http://127.0.0.1:${process.env["API_PORT"] ?? 8787}`, changeOrigin: false } },
  },
  build: { outDir: "dist" },
});
