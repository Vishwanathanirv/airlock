# Airlock · Spec

## Problem
Apps that put an LLM in front of users get prompt injection, jailbreaks and planted instructions in retrieved documents, and leak secrets, personal data and system prompts through the answers.

## Core (MVP)
A drop-in proxy (`baseURL` change) that blocks, redacts or flags each message going in and each answer coming out.

## Flow (demo)
1. Split screen: the same chat sent straight to a gullible bot and through Airlock
2. Presets or your own attack; edit the help article to plant one
3. Each turn shows the verdict and findings; the X-ray marks hidden and exfiltrating text
4. Tools drawer: Traffic log, X-ray lab, Policy and setup, Results

## Pipeline
unmask (invisible and tag characters) → decode (base64, hex and similar) → detect (rules + classifier score against thresholds) → redact (secrets, PII to placeholders) → decide (allow, flag, redact, block) → on the way out: prompt-leak and exfiltration checks, placeholders restored

## API
| Route | Auth | Limit |
| --- | --- | --- |
| POST /v1/chat/completions | Airlock key | 60/min per key |
| POST /v1/scan | Airlock key | 240/min per IP |
| GET /api/events · GET/PUT /api/policy | x-admin-token | 20/min per IP |
| GET /api/health | none | 240/min per IP |

## Data
No database. The server keeps the last 500 scrubbed events and the policy in memory. The browser demo keeps the policy in localStorage (`airlock-policy-v1`).

## States
- Loading: "Loading the scanner…" while the classifier loads; Results pages say what they are loading.
- Empty: traffic log says to send a message first.
- Errors: classifier failure shown with Reload; missing report files say which command creates them; upstream errors come back as OpenAI-style errors.

## Out of scope
Training on user traffic, storing conversations, a hosted multi-tenant service.
