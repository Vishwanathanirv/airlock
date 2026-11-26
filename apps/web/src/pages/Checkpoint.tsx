import { useEffect, useRef, useState, type RefObject } from "react";
import { checkRequest, checkResponse, gullibleReply, NORTHWIND_SYSTEM, type Action, type ChatMessage, type Finding } from "@airlock/core";
import { record, useModel, usePolicy } from "../lib";
import { PRESETS, ROAMING_ARTICLE, type Preset } from "../presets";
import { Findings, Gate, Legend, Xray } from "../xray";

type Turn = {
  id: number;
  user: string;
  article: string;
  /** What the bot says when it gets the raw conversation. */
  naked: string;
  nakedLeaks: boolean;
  inAction: Action;
  inFindings: Finding[];
  /** Findings positioned on "message, blank line, article", for the X-ray view. */
  xray: Finding[];
  raw: string | null;
  outAction: Action | null;
  outFindings: Finding[];
  shown: string;
  forward: ChatMessage[];
  ms: number;
};

const REFUSAL_IN = "I can't help with that. (Stopped by Airlock before it reached me.)";
const REFUSAL_OUT = "Sorry, I can't share that. (Airlock withheld my answer because it would have leaked protected information.)";

/** One side of the split screen: the same chat, with or without Airlock in front. */
function Phone({ guarded, turns, busy, scroller }: { guarded: boolean; turns: Turn[]; busy: boolean; scroller: RefObject<HTMLDivElement | null> }) {
  return (
    <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden !bg-[var(--phone)] shadow-[var(--shadow)]" aria-label={guarded ? "Through Airlock" : "Straight to the model"}>
      <header className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <span className={`grid h-8 w-8 place-items-center rounded-full text-[13px] font-bold text-white ${guarded ? "bg-go" : "bg-stop"}`} aria-hidden>
          N
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[15px] font-bold">Nova</div>
          <div className="text-xs text-muted">{guarded ? "Through Airlock" : "Straight to the model, no protection"}</div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${guarded ? "bg-[var(--x-hidden-bg)] text-go" : "bg-[var(--x-out-bg)] text-stop"}`}>{guarded ? "Protected" : "Exposed"}</span>
      </header>
      <div ref={scroller} className="scroll-y min-h-0 flex-1 space-y-3 p-4" aria-live="polite">
        {!turns.length && <p className="py-10 text-center text-sm text-muted">Send a message below. It goes to both sides at once.</p>}
        {turns.map((t) => {
          const text = guarded ? t.shown : t.naked;
          const bad = guarded ? t.inAction === "block" || t.outAction === "block" : t.nakedLeaks;
          return (
            <div key={t.id} className="space-y-2">
              <div className="bubble-in ml-auto max-w-[88%] rounded-[18px] rounded-br-[6px] bg-[var(--bubble-me)] px-3.5 py-2 text-[14.5px] text-[var(--bubble-me-ink)]">
                <p className="whitespace-pre-wrap break-words">{t.user.replace(/[\u{E0000}-\u{E007F}]/gu, "")}</p>
              </div>
              <div className={`bubble-in max-w-[88%] rounded-[18px] rounded-bl-[6px] px-3.5 py-2 text-[14.5px] ${guarded && bad ? "border border-line bg-panel" : "bg-[var(--bubble-bot)]"}`}>
                <p className={`whitespace-pre-wrap break-words ${!guarded && bad ? "text-stop" : ""}`}>{text}</p>
                {guarded && (
                  <div className="mt-1.5">
                    <Gate action={strongest(t.inAction, t.outAction)} size="sm" />
                  </div>
                )}
                {!guarded && bad && <p className="mt-1 text-xs font-semibold text-stop">The attack worked.</p>}
              </div>
            </div>
          );
        })}
        {busy && <div className="h-8 w-14 animate-pulse rounded-[18px] bg-[var(--bubble-bot)]" aria-label="Nova is typing" />}
      </div>
    </section>
  );
}

export function Checkpoint() {
  const { model, error } = useModel();
  const policy = usePolicy();
  const [text, setText] = useState("");
  const [article, setArticle] = useState(ROAMING_ARTICLE);
  const [editArticle, setEditArticle] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState<"naked" | "scanner" | "guarded">("guarded");
  const [lens, setLens] = useState<"in" | "out" | "sent">("in");
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  // Keep the newest exchange in view on both sides.
  useEffect(() => {
    for (const r of [left, right]) r.current?.scrollTo({ top: r.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, busy]);

  async function send(userText: string, art = article) {
    if (!userText.trim() || !model || busy) return;
    setBusy(true);
    const messages: ChatMessage[] = [
      { role: "system", content: NORTHWIND_SYSTEM },
      { role: "user", content: art, source: "context" },
      { role: "user", content: userText },
    ];
    const t0 = performance.now();
    const req = checkRequest(messages, { policy, model });
    const inFindings = req.checks.flatMap((c) => c.findings);
    const offset = userText.length + 2;
    const xray = [
      ...(req.checks.find((c) => c.source === "user")?.findings ?? []),
      ...(req.checks.find((c) => c.source === "context")?.findings ?? []).map((f) => (f.span ? { ...f, span: { start: f.span.start + offset, end: f.span.end + offset } } : f)),
    ];
    record({ direction: "in", action: req.action, findings: inFindings, preview: userText.slice(0, 140), ms: req.checks.reduce((a, c) => a + c.ms, 0) });
    const blockedIn = req.action === "block";
    const raw = blockedIn ? null : gullibleReply(req.forward);
    const out = raw !== null ? checkResponse(raw, req, policy) : null;
    if (out) record({ direction: "out", action: out.action, findings: out.findings, preview: raw!.slice(0, 140), ms: out.ms });
    const shown = blockedIn ? REFUSAL_IN : out!.action === "block" ? REFUSAL_OUT : out!.text;
    // The unprotected side: the bot gets the raw conversation, and its answer goes straight out.
    const naked = gullibleReply(messages);
    const nakedCheck = checkResponse(naked, checkRequest(messages, { policy, model }), policy);
    const ms = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 380));
    setTurns((t) => [...t, { id: Date.now(), user: userText, article: art, naked, nakedLeaks: blockedIn || nakedCheck.action === "block" || nakedCheck.findings.some((f) => f.category === "exfiltration" || f.category === "prompt-leak"), inAction: req.action, inFindings, xray, raw, outAction: out?.action ?? null, outFindings: out?.findings ?? [], shown, forward: req.forward, ms }]);
    setText("");
    setLens(blockedIn ? "in" : out && out.action !== "allow" ? "out" : "in");
    setBusy(false);
  }

  function runPreset(p: Preset) {
    const art = p.article ?? ROAMING_ARTICLE;
    setArticle(art);
    void send(p.user, art);
  }


  const last = turns.at(-1);
  return (
    <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] gap-3 p-2 sm:p-3">
      <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,1.15fr)_minmax(0,1fr)]">
        {/* Phones: side by side on wide screens, one at a time on narrow ones. */}
        <div className={`min-h-0 ${side === "naked" ? "flex" : "hidden"} flex-col lg:flex`}>
          <Phone guarded={false} turns={turns} busy={busy} scroller={left} />
        </div>

        {/* The scanner between them */}
        <section className={`panel scroll-y min-h-0 p-4 ${side === "scanner" ? "block" : "hidden"} lg:block`} aria-label="Scanner">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[1.05rem] font-bold">The scanner</h1>
            {last && <span className="font-mono text-xs text-faint">{last.ms.toFixed(1)} ms</span>}
          </div>
          {!last ? (
            <div className="mt-3 space-y-3 text-sm text-muted">
              <p>Nova is the support bot of Northwind Telecom, a made-up phone company, and Nova is deliberately gullible: it obeys any instruction it reads, including ones hidden in the help article it looks up.</p>
              <p>Every message you send goes to both sides at once. On the left, straight to the model. On the right, through Airlock. This panel shows what Airlock saw and why it decided.</p>
              <Legend />
            </div>
          ) : (
            <>
              <div className="mt-3 flex items-center gap-2">
                <Gate action={strongest(last.inAction, last.outAction)} />
                <span className="text-sm text-muted">{last.inFindings.length + last.outFindings.length ? `${last.inFindings.length + last.outFindings.length} finding${last.inFindings.length + last.outFindings.length === 1 ? "" : "s"}` : "Nothing suspicious"}</span>
              </div>
              <div className="mt-3 flex gap-1 rounded-[10px] bg-panel-2 p-1 text-[13px]" role="tablist" aria-label="What to look at">
                {(
                  [
                    ["in", "Going in"],
                    ["out", "Coming out"],
                    ["sent", "What the model got"],
                  ] as const
                ).map(([k, t]) => (
                  <button key={k} role="tab" aria-selected={lens === k} disabled={k !== "in" && last.raw === null} onClick={() => setLens(k)} className={`flex-1 rounded-[8px] px-2 py-1.5 font-semibold disabled:opacity-40 ${lens === k ? "bg-panel shadow-[var(--shadow)]" : "text-muted"}`}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="relative mt-3 overflow-hidden rounded-[14px]">
                <div key={last.id} className="sweep pointer-events-none absolute inset-x-0 top-0 z-10 h-1/3 bg-gradient-to-b from-transparent via-[var(--x-data-bg)] to-transparent" aria-hidden />
                {lens === "in" && <Xray text={`${last.user}\n\n${last.article}`} findings={last.xray} className="max-h-[22rem] overflow-y-auto" />}
                {lens === "out" && last.raw !== null && <Xray text={last.raw} findings={last.outFindings} className="max-h-[22rem] overflow-y-auto" />}
                {lens === "sent" && (
                  <pre className="xray max-h-[22rem] overflow-auto px-4 py-3 text-[12px] text-muted">
                    {last.forward
                      .filter((m) => m.role !== "system")
                      .map((m) => `${m.source === "context" ? "article" : m.role}: ${m.content}`)
                      .join("\n\n")}
                    {"\n\nsystem: …"}
                    {last.forward.find((m) => m.role === "system")?.content.split("\n").at(-1)}
                  </pre>
                )}
              </div>
              <p className="mt-2 text-xs text-muted">
                {lens === "in" ? "The user's message, a blank line, then the help article: as the scanner sees them." : lens === "out" ? "Nova's raw answer, before the user sees it." : "Personal data swapped for placeholders, and a canary planted in the system prompt: if it shows up in an answer, the prompt is leaking."}
              </p>
              <div className="mt-2">
                <Legend />
              </div>
              <div className="mt-4">
                <Findings findings={lens === "out" ? last.outFindings : last.inFindings} empty={lens === "out" ? "Nothing leaking in the answer." : "Nothing suspicious going in."} />
              </div>
            </>
          )}
        </section>

        <div className={`min-h-0 ${side === "guarded" ? "flex" : "hidden"} flex-col lg:flex`}>
          <Phone guarded turns={turns} busy={busy} scroller={right} />
        </div>
      </div>

      {/* The composer, sending to both sides */}
      <div className="panel min-w-0 p-2.5 shadow-[var(--shadow)]">
        <div className="mb-2 flex items-center gap-2 lg:hidden" role="tablist" aria-label="Which side">
          {(
            [
              ["naked", "Without"],
              ["scanner", "Scanner"],
              ["guarded", "With Airlock"],
            ] as const
          ).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={side === k} onClick={() => setSide(k)} className={`flex-1 rounded-[10px] px-2 py-1.5 text-[13px] font-semibold ${side === k ? "bg-sign text-sign-ink" : "bg-panel-2 text-muted"}`}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-2" aria-label="Attacks to try">
          {PRESETS.map((p) => (
            <button key={p.name} className="btn h-8 shrink-0 rounded-full px-3 text-[13px]" disabled={busy || !model} onClick={() => runPreset(p)} title={p.note}>
              {p.name}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <button type="button" className={`btn shrink-0 ${editArticle ? "border-ink" : ""}`} onClick={() => setEditArticle(!editArticle)} aria-expanded={editArticle} title="The help article Nova reads before answering">
            Article
          </button>
          <input className="field" placeholder={error ? "Scanner unavailable" : model ? "Ask Nova something, or write your own attack" : "Loading the scanner…"} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message to Nova" />
          <button className="btn btn-sign shrink-0" disabled={busy || !text.trim() || !model}>
            Send to both
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-2 text-[13px] text-[var(--stop)]">
            The scanner could not load ({error}).{" "}
            <button type="button" className="font-semibold underline underline-offset-2" onClick={() => location.reload()}>
              Reload
            </button>
          </p>
        )}
        {editArticle && (
          <label className="mt-2 block">
            <span className="text-xs font-semibold text-muted">The help article Nova looks up before answering. Edit it to plant your own attack.</span>
            <textarea className="field mt-1 min-h-24 font-mono text-[12.5px]" value={article} onChange={(e) => setArticle(e.target.value)} aria-label="Help article" />
          </label>
        )}
      </div>
    </div>
  );
}

const RANK: Record<Action, number> = { allow: 0, flag: 1, redact: 2, block: 3 };
const strongest = (a: Action, b: Action | null) => (b && RANK[b] > RANK[a] ? b : a);
