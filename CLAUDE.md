# Airlock

Firewall for LLM apps: an OpenAI-compatible proxy that scans messages in and answers out. npm workspaces: `packages/core` (engine), `apps/api` (Fastify proxy), `apps/web` (Vite + React + Tailwind demo that runs the engine in the browser).

## Commands
- `npm run dev` · `npm run build` · `npm start` (proxy on :8080)
- `npm run lint && npm run typecheck && npm test` before every commit
- `npm run test:e2e` (Playwright on the demo build)
- `npm run train` → `models/classifier.json` · `npm run evaluate` (synthetic) · `npm run bench` (real public datasets)

## Layout
- `packages/core/src`: `normalize` (unmask, decode), `rules`, `classifier`, `dlp` (secrets, PII, redact/restore), `firewall` (decide), `session`
- `apps/api/src/app.ts`: routes, auth (client keys, admin token), rate limits
- `apps/web/src`: `pages/Checkpoint` (split screen), `Scanner`, `Integrate`, `Results`, `RealResults`; `xray.tsx`

## Rules
- One dark theme. No italics. No intro modal, "How it works" or "Try it": the split screen explains itself.
- Every paid upstream route has its own per-key rate limit; admin routes are limited to stop token guessing.
- Logs never hold personal data or secrets (`scrub` before storing).
- Benchmark numbers come only from `npm run bench` on public datasets, with source and licence. Synthetic results are labelled synthetic.
- No personal details or repo links in code, UI or metadata (dataset source links are allowed).
