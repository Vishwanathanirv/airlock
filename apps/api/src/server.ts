import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

if (process.env.NODE_ENV === "production" && !process.env.AIRLOCK_KEYS) {
  console.error("AIRLOCK_KEYS must be set in production, or anyone could use your upstream model through this proxy.");
  process.exit(1);
}

const webDir = resolve(process.cwd(), "apps/web/dist");
const app = await buildApp({
  logger: true,
  upstreamUrl: process.env.UPSTREAM_URL,
  upstreamKey: process.env.UPSTREAM_API_KEY,
  clientKeys: list(process.env.AIRLOCK_KEYS),
  adminToken: process.env.ADMIN_TOKEN,
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  webDir: existsSync(webDir) ? webDir : undefined,
});
await app.listen({ port, host });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
