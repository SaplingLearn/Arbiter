import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative base so the built index.html opens directly from the filesystem.
  // The static ZIP submission depends on this.
  base: "./",
  build: { outDir: "dist", assetsInlineLimit: 0 },
});
