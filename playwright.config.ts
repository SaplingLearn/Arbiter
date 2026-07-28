import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "apps/web/e2e",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "npm run web:build && npm run -w @arbiter/web preview -- --port 4173",
    port: 4173,
    reuseExistingServer: true,
  },
});
