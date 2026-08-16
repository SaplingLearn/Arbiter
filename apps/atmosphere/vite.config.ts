import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  // Bound to the IPv4 loopback explicitly. Left to itself Vite binds ::1 only, and
  // both Playwright and Chrome resolve 127.0.0.1 first — the failure looks like a
  // dead server while curl on `localhost` happily succeeds.
  server: { port: 5180, strictPort: true, host: "127.0.0.1" },
  build: { outDir: "dist", emptyOutDir: true },
});
