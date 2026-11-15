import { defineConfig } from "@playwright/test";

/** End-to-end checks run against the static demo build, the same thing Vercel serves. */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:4313" },
  webServer: { command: "npx vite preview --port 4313 --strictPort", cwd: "apps/web", url: "http://localhost:4313", reuseExistingServer: !process.env.CI },
});
