import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.pw.ts",
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  outputDir: "../../node_modules/.cache/ui-results",
  use: { baseURL: "http://127.0.0.1:1437", viewport: { width: 1100, height: 720 }, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { browserName: "chromium", channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    command: "pnpm exec vite --config scripts/shots/vite.config.ts --host 127.0.0.1 --port 1437 --strictPort",
    url: "http://127.0.0.1:1437/scripts/ui/",
    reuseExistingServer: false,
  },
});
