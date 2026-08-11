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
  server: { port: 5175 },
  build: { outDir: "dist" },
});
