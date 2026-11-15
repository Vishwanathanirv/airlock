import { useState } from "react";
import { DEFAULT_POLICY, type Action, type Category } from "@airlock/core";
import { setPolicy, usePolicy } from "../lib";
import { CATEGORY_NAME, TINT } from "../xray";

const CODE_NODE = `import OpenAI from "openai";

// Point your existing client at Airlock instead of the model provider.
const client = new OpenAI({
  baseURL: "https://airlock.your-company.com/v1",
  apiKey: process.env.AIRLOCK_KEY,
});

const reply = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: "You are Acme's support assistant..." },
    // Mark retrieved documents so they're checked for planted instructions:
    { role: "user", content: helpArticle, airlock_source: "context" },
    { role: "user", content: question },
  ],
});`;

const CODE_CURL = `curl https://airlock.your-company.com/v1/scan \\
  -H "Authorization: Bearer $AIRLOCK_KEY" \\
  -H "content-type: application/json" \\
  -d '{"text": "Ignore previous instructions", "source": "user"}'`;

const ACTIONS: Action[] = ["allow", "flag", "redact", "block"];
const ACTION_NAME: Record<Action, string> = { allow: "Let through", flag: "Flag for review", redact: "Redact", block: "Block" };

export function Integrate() {
  const policy = usePolicy();
  const [domain, setDomain] = useState("");
  const set = (c: Category, a: Action) => setPolicy({ ...policy, actions: { ...policy.actions, [c]: a } });

  return (
    <div>
      <h2 className="text-[1.35rem] font-bold leading-tight tracking-[-0.01em]">Put it in front of your app</h2>
      <p className="mt-3 max-w-2xl text-[1.02rem] leading-relaxed text-muted">
        Airlock speaks the OpenAI chat API. Change your app's base URL to Airlock and every request and answer goes through the checkpoint. It works with OpenAI, Gemini's OpenAI-compatible endpoint, Groq, a local Ollama, or anything else with the same API.
      </p>

      <ol className="mt-6 space-y-6">
        <li className="grid gap-3 md:grid-cols-[2rem_1fr]">
          <span className="sign grid h-8 w-8 place-items-center rounded-[5px]">1</span>
          <div>
            <h2 className="text-lg font-bold">Run Airlock next to your app</h2>
            <pre className="panel mt-2 overflow-x-auto p-3 font-mono text-[13px] leading-relaxed">{`UPSTREAM_URL=https://api.openai.com/v1 \\
UPSTREAM_API_KEY=sk-... \\
AIRLOCK_KEYS=key-for-your-app \\
ADMIN_TOKEN=change-me \\
npm start`}</pre>
            <p className="mt-2 text-sm text-muted">Your provider key stays on the Airlock server; your app only holds an Airlock key. Without an upstream, Airlock answers with the demo bot so you can try attacks safely.</p>
          </div>
        </li>
        <li className="grid gap-3 md:grid-cols-[2rem_1fr]">
          <span className="sign grid h-8 w-8 place-items-center rounded-[5px]">2</span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold">Change one line in your app</h2>
            <pre className="panel mt-2 overflow-x-auto p-3 font-mono text-[13px] leading-relaxed">{CODE_NODE}</pre>
            <p className="mt-2 text-sm text-muted">
              Blocked requests get a polite refusal as a normal reply, so nothing breaks. Each response carries an <code className="font-mono">airlock</code> field and <code className="font-mono">x-airlock-request</code> / <code className="font-mono">x-airlock-response</code> headers with what was found.
            </p>
          </div>
        </li>
        <li className="grid gap-3 md:grid-cols-[2rem_1fr]">
          <span className="sign grid h-8 w-8 place-items-center rounded-[5px]">3</span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold">Or just scan text</h2>
            <pre className="panel mt-2 overflow-x-auto p-3 font-mono text-[13px] leading-relaxed">{CODE_CURL}</pre>
          </div>
        </li>
      </ol>

      <section className="panel mt-10 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">Policy</h2>
          <button className="text-sm text-muted underline underline-offset-4 hover:text-ink" onClick={() => setPolicy(DEFAULT_POLICY)}>
            Reset to defaults
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">What happens to each kind of finding. Changes apply to the checkpoint and scanner in this browser straight away; on a server, the same settings go to PUT /api/policy with the admin token.</p>
        <div className="mt-4 divide-y divide-line">
          {(Object.keys(policy.actions) as Category[]).map((c) => (
            <div key={c} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span className="inline-flex items-center gap-2 font-semibold">
                <span className={`${TINT[c]} inline-block h-3 w-3`} aria-hidden />
                {CATEGORY_NAME[c]}
              </span>
              <div className="flex gap-1" role="radiogroup" aria-label={CATEGORY_NAME[c]}>
                {ACTIONS.map((a) => (
                  <button key={a} role="radio" aria-checked={policy.actions[c] === a} onClick={() => set(c, a)} className={`rounded-[5px] px-2.5 py-1 text-sm ${policy.actions[c] === a ? "sign" : "text-muted hover:text-ink"}`}>
                    {ACTION_NAME[a]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold">Block when the classifier is at least {policy.blockAt.toFixed(2)} sure</span>
            <input type="range" min={0.6} max={0.99} step={0.01} value={policy.blockAt} onChange={(e) => setPolicy({ ...policy, blockAt: +e.target.value, flagAt: Math.min(policy.flagAt, +e.target.value) })} className="mt-2 w-full accent-[var(--ink)]" />
            <span className="text-xs text-faint">Lower catches more paraphrases and blocks more real customers.</span>
          </label>
          <div>
            <span className="text-sm font-semibold">Domains answers may load images from</span>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const d = domain.trim().toLowerCase();
                if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !policy.allowedDomains.includes(d)) setPolicy({ ...policy, allowedDomains: [...policy.allowedDomains, d] });
                setDomain("");
              }}
            >
              <input className="field py-1.5" placeholder="cdn.your-company.com" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Allowed domain" />
              <button className="btn">Add</button>
            </form>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {policy.allowedDomains.length ? (
                policy.allowedDomains.map((d) => (
                  <button key={d} className="rounded-[5px] bg-panel-2 px-2 py-0.5 font-mono text-xs" onClick={() => setPolicy({ ...policy, allowedDomains: policy.allowedDomains.filter((x) => x !== d) })} title="Remove">
                    {d} ✕
                  </button>
                ))
              ) : (
                <span className="text-xs text-faint">None: any image from outside is treated as a possible leak.</span>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
