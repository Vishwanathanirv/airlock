/**
 * Airlock's proxy. Speaks the OpenAI chat-completions API, so an app switches to it by changing
 * its base URL. Every request is inspected before it is forwarded, every answer before it is
 * returned, and each exchange is logged for the dashboard.
 *
 * Without an upstream configured it answers with the built-in gullible bot, so the whole thing
 * runs (and can be attacked) with no API key.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { checkRequest, checkResponse, DEFAULT_POLICY, deserialize, gullibleReply, inspect, NORTHWIND_SYSTEM, scrub, type Action, type ChatMessage, type Finding, type Model, type Policy } from "@airlock/core";

const here = dirname(fileURLToPath(import.meta.url));

export type Event = { id: string; at: number; direction: "request" | "response"; action: Action; findings: Finding[]; preview: string; ms: number; upstream: string };

export type Options = {
  logger?: boolean;
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1. Empty: the built-in demo bot answers. */
  upstreamUrl?: string;
  upstreamKey?: string;
  /** Keys clients must present to use the proxy. Empty: open (development only). */
  clientKeys?: string[];
  adminToken?: string;
  model?: Model;
  fetchImpl?: typeof fetch;
  webDir?: string;
  /** Proxy hops to trust for the client address (X-Forwarded-For). 0 or unset trusts none, so the header can't be spoofed. */
  trustProxy?: number;
  /** Chat completions allowed per client key (or IP when keys are off) per minute. Each one may cost upstream credits. */
  chatPerMinute?: number;
};

const Message = z.object({ role: z.enum(["system", "user", "assistant", "tool"]), content: z.string().max(200_000), airlock_source: z.enum(["user", "context", "tool"]).optional() });
const Completion = z.object({ model: z.string().default("gpt-4o-mini"), messages: z.array(Message).min(1).max(200) }).passthrough();
const Scan = z.object({ text: z.string().max(200_000), source: z.enum(["user", "context", "tool", "output"]).default("user") });
const PolicyBody = z.object({
  actions: z.record(z.enum(["injection", "jailbreak", "prompt-leak", "hidden-text", "encoded", "exfiltration", "secret", "pii"]), z.enum(["allow", "flag", "redact", "block"])).optional(),
  blockAt: z.number().min(0.5).max(0.99).optional(),
  flagAt: z.number().min(0.3).max(0.99).optional(),
  allowedDomains: z.array(z.string().regex(/^[a-z0-9.-]+$/i)).max(100).optional(),
});

const REFUSAL = "I can't help with that request. (Blocked by Airlock: the message looked like an attempt to override my instructions or extract data.)";

export function loadModel(): Model {
  const candidates = [resolve(here, "../../../models/classifier.json"), resolve(process.cwd(), "models/classifier.json")];
  for (const p of candidates) {
    try {
      return deserialize(JSON.parse(readFileSync(p, "utf8")));
    } catch {
      /* try the next */
    }
  }
  throw new Error("models/classifier.json not found. Run `npm run train`.");
}

export async function buildApp(opts: Options = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024, trustProxy: trustHops(opts.trustProxy) });
  const model = opts.model ?? loadModel();
  const doFetch = opts.fetchImpl ?? fetch;
  let policy: Policy = structuredClone(DEFAULT_POLICY);
  const events: Event[] = [];
  const counts = { requests: 0, blocked: 0, redacted: 0, flagged: 0 };
  // Personal data and secrets are scrubbed from everything that is logged, whatever the policy
  // says to do with them on the way to the model.
  const log = (e: Omit<Event, "id" | "at">) => {
    events.unshift({ ...e, preview: scrub(e.preview), findings: e.findings.map((f) => ({ ...f, evidence: scrub(f.evidence) })), id: crypto.randomUUID(), at: Date.now() });
    if (events.length > 500) events.length = 500;
  };
  const upstreamName = opts.upstreamUrl ? new URL(opts.upstreamUrl).host : "demo bot";

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 240, timeWindow: "1 minute" });

  // Paid upstream calls get their own, tighter budget per client key, so one leaked or runaway key
  // can't drain the upstream account. Admin routes are limited hard to stop token guessing.
  // Only a configured key earns its own bucket: an unknown or made-up Authorization header falls
  // back to the client address, so rotating headers can't mint fresh budgets.
  const clientId = (req: FastifyRequest) => {
    const key = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    const known = key && opts.clientKeys?.some((k) => sameSecret(key, k));
    return known ? `key:${createHash("sha256").update(key).digest("hex").slice(0, 16)}` : `ip:${req.ip}`;
  };
  const chatLimit = { rateLimit: { max: opts.chatPerMinute ?? 60, timeWindow: "1 minute", keyGenerator: clientId } };
  const adminLimit = { rateLimit: { max: 20, timeWindow: "1 minute" } };

  const requireClient = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!opts.clientKeys?.length) return;
    const key = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!key || !opts.clientKeys.some((k) => sameSecret(key, k))) return reply.code(401).send({ error: { message: "Missing or invalid Airlock key.", type: "authentication_error" } });
  };
  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.headers["x-admin-token"];
    if (!opts.adminToken || typeof token !== "string" || !sameSecret(token, opts.adminToken)) return reply.code(403).send({ error: "This needs the admin token (x-admin-token header)." });
  };

  app.get("/api/health", async () => ({ ok: true, upstream: upstreamName, classifier: true }));

  app.post("/v1/scan", { preHandler: requireClient }, async (req, reply) => {
    const body = Scan.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0].message });
    const { matches: _m, ...verdict } = inspect(body.data.text, body.data.source, policy, model);
    return verdict;
  });

  app.post("/v1/chat/completions", { preHandler: requireClient, config: chatLimit }, async (req, reply) => {
    const body = Completion.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: { message: body.error.issues[0].message, type: "invalid_request_error" } });
    counts.requests++;
    const messages: ChatMessage[] = body.data.messages.map((m) => ({ role: m.role, content: m.content, source: m.airlock_source }));
    if (!opts.upstreamUrl && !messages.some((m) => m.role === "system")) messages.unshift({ role: "system", content: NORTHWIND_SYSTEM });

    const t0 = performance.now();
    const check = checkRequest(messages, { policy, model });
    const inFindings = check.checks.flatMap((c) => c.findings);
    log({ direction: "request", action: check.action, findings: inFindings, preview: (check.forward.at(-1)?.content ?? "").slice(0, 160), ms: performance.now() - t0, upstream: upstreamName });
    reply.header("x-airlock-request", check.action);
    if (check.action === "block") {
      counts.blocked++;
      return completion(body.data.model, REFUSAL, { request: check.action, response: "skipped", findings: inFindings });
    }
    if (check.action === "redact") counts.redacted++;
    if (check.action === "flag") counts.flagged++;

    let answer: string;
    if (opts.upstreamUrl) {
      const res = await doFetch(`${opts.upstreamUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(opts.upstreamKey ? { authorization: `Bearer ${opts.upstreamKey}` } : {}) },
        // Streaming is turned off: the whole answer has to be checked before the user sees any of it.
        body: JSON.stringify({ ...body.data, stream: false, messages: check.forward.map((m) => ({ role: m.role, content: m.content })) }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return reply.code(502).send({ error: { message: `Upstream returned ${res.status}.`, type: "upstream_error" } });
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      answer = j.choices?.[0]?.message?.content ?? "";
    } else {
      answer = gullibleReply(check.forward);
    }

    const t1 = performance.now();
    const out = checkResponse(answer, check, policy);
    log({ direction: "response", action: out.action, findings: out.findings, preview: out.text.slice(0, 160), ms: performance.now() - t1, upstream: upstreamName });
    reply.header("x-airlock-response", out.action);
    if (out.action === "block") {
      counts.blocked++;
      return completion(body.data.model, "Sorry, I can't share that. (Airlock withheld this answer because it would have leaked protected information.)", { request: check.action, response: out.action, findings: [...inFindings, ...out.findings] });
    }
    return completion(body.data.model, out.text, { request: check.action, response: out.action, findings: [...inFindings, ...out.findings] });
  });

  app.get("/api/events", { preHandler: requireAdmin, config: adminLimit }, async () => ({ events: events.slice(0, 200), counts }));
  // The policy says what gets through (thresholds, allowed domains), so reading it is admin-only too.
  app.get("/api/policy", { preHandler: requireAdmin, config: adminLimit }, async () => policy);
  app.put("/api/policy", { preHandler: requireAdmin, config: adminLimit }, async (req, reply) => {
    const body = PolicyBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.issues[0].message });
    policy = { ...policy, ...body.data, actions: { ...policy.actions, ...(body.data.actions ?? {}) } };
    if (policy.flagAt > policy.blockAt) policy.flagAt = policy.blockAt;
    return policy;
  });

  if (opts.webDir) {
    await app.register(fastifyStatic, { root: opts.webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/v1") ? reply.sendFile("index.html") : reply.code(404).send({ error: "Not found" })));
  }
  return app;
}

/** Trust exactly n proxy hops for X-Forwarded-For; 0 trusts none. */
function trustHops(n = 0): false | ((address: string, hop: number) => boolean) {
  const hops = Math.max(0, Math.floor(n));
  return hops > 0 ? (_address, hop) => hop < hops : false;
}

/** Compares two secrets in constant time, so response timing doesn't reveal how much of a guess was right. */
function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function completion(model: string, content: string, airlock: { request: Action; response: Action | "skipped"; findings: Finding[] }) {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    airlock: { ...airlock, findings: airlock.findings.map(({ detector, category, severity, evidence, why }) => ({ detector, category, severity, evidence, why })) },
  };
}
