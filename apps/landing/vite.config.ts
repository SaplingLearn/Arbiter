import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
 *
 * TAILWIND IS v4, so there is no `tailwind.config.js` and no PostCSS entry to look for.
 * v4 configures itself from CSS — the tokens live in an `@theme` block in `shell.css`
 * — and the Vite plugin below is the whole build integration. Anyone arriving from a v3
 * project will go looking for a config file that is deliberately not there.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Bound to the IPv4 loopback explicitly. Left to itself Vite binds ::1 only, and
  // both Playwright and Chrome resolve 127.0.0.1 first — the failure looks like a dead
  // server while curl on `localhost` happily succeeds. `apps/atmosphere` hit this first
  // and carries the same pin for the same reason.
  server: { port: 5175, host: "127.0.0.1" },
  build: { outDir: "dist" },
});
