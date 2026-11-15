import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from "react-router";
import "@fontsource-variable/host-grotesk";
import "@fontsource/jetbrains-mono/400.css";
import "./index.css";
import { time, useLog } from "./lib";
import { Checkpoint } from "./pages/Checkpoint";
import { Integrate } from "./pages/Integrate";
import { Results } from "./pages/Results";
import { Scanner } from "./pages/Scanner";
import { CATEGORY_NAME, Gate } from "./xray";

/** The drawer's tabs, like browser devtools. Each has its own address so it can be linked. */
const TOOLS = [
  { to: "/log", t: "Traffic log", key: "1" },
  { to: "/scanner", t: "X-ray lab", key: "2" },
  { to: "/integrate", t: "Policy and setup", key: "3" },
  { to: "/results", t: "Results", key: "4" },
];

function Log() {
  const log = useLog();
  const [filter, setFilter] = useState<"all" | "stopped">("all");
  const rows = filter === "all" ? log : log.filter((e) => e.action !== "allow");
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[1.35rem] font-bold">Traffic log</h2>
        <div className="flex gap-1 rounded-[10px] bg-panel-2 p-1 text-[13px]">
          {(
            [
              ["all", "Everything"],
              ["stopped", "Only what Airlock acted on"],
            ] as const
          ).map(([k, t]) => (
            <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`rounded-[8px] px-2.5 py-1 font-semibold ${filter === k ? "bg-panel shadow-[var(--shadow)]" : "text-muted"}`}>
              {t}
            </button>
          ))}
        </div>
        <span className="text-sm text-muted">In this browser. On a server, the same entries come from GET /api/events (admin token), with personal data already redacted.</span>
      </div>
      <div className="mt-3 overflow-x-auto rounded-[14px] border border-line bg-panel">
        {rows.length ? (
          <table className="w-full font-mono text-[12.5px]">
            <thead className="text-left text-faint">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-2 py-2 font-medium">Way</th>
                <th className="px-2 py-2 font-medium">Verdict</th>
                <th className="px-2 py-2 font-medium">Found</th>
                <th className="px-2 py-2 text-right font-medium">ms</th>
                <th className="px-3 py-2 font-medium">Text</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{time(e.at)}</td>
                  <td className="whitespace-nowrap px-2 py-2">{e.direction === "in" ? "→ model" : "← user"}</td>
                  <td className="px-2 py-2 font-sans">
                    <Gate action={e.action} size="sm" />
                  </td>
                  <td className="px-2 py-2 font-sans text-muted">{[...new Set(e.findings.map((f) => CATEGORY_NAME[f.category]))].join(", ") || "Nothing"}</td>
                  <td className="px-2 py-2 text-right text-muted">{e.ms.toFixed(2)}</td>
                  <td className="max-w-md truncate px-3 py-2 text-muted">{e.preview.replace(/[\u{E0000}-\u{E007F}]/gu, "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-10 text-center font-sans text-sm text-muted">Nothing yet. Send a message on the split screen above.</p>
        )}
      </div>
    </div>
  );
}

function useTheme(): [string, () => void] {
  const [t, setT] = useState(() => {
    try {
      return localStorage.getItem("airlock-theme") ?? "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("airlock-theme", t);
    } catch {
      /* private mode */
    }
  }, [t]);
  return [t, () => setT(t === "system" ? "dark" : t === "dark" ? "light" : "system")];
}

function Shell() {
  const loc = useLocation();
  const navigate = useNavigate();
  const log = useLog();
  const [theme, cycle] = useTheme();
  const tool = TOOLS.find((t) => t.to === loc.pathname);
  const [height, setHeight] = useState(() => Math.round(window.innerHeight * 0.46));
  const drag = useRef<{ y: number; h: number } | null>(null);
  const acted = log.filter((e) => e.action !== "allow").length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = TOOLS.find((x) => x.key === e.key);
      if (t) navigate(loc.pathname === t.to ? "/" : t.to);
      if (e.key === "Escape" && tool) navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, loc.pathname, tool]);

  return (
    <div className="grid h-dvh grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto]">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2">
        <Link to="/" className="flex items-center gap-2 text-[1.1rem] font-extrabold tracking-tight">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          Airlock
        </Link>
        <span className="hidden text-sm text-muted md:inline">A firewall for LLM apps. Same chat, twice: once unprotected, once through Airlock.</span>
        <span className="flex-1" />
        <button className="btn h-8 px-3 text-[13px]" onClick={cycle} title="Switch theme">
          {theme === "system" ? "Auto" : theme === "dark" ? "Dark" : "Light"}
        </button>
        <a href="https://github.com/Vishwanathanirv/llm-firewall" className="hidden text-sm font-semibold text-muted hover:text-ink sm:block">
          Source
        </a>
        <a href="https://vishwanathan.dev" className="hidden text-sm text-faint hover:text-ink lg:block">
          by Vishwanathan R
        </a>
      </header>

      <main className="min-h-0">
        <Checkpoint />
      </main>

      {/* The tools drawer */}
      <section className="flex min-w-0 flex-col border-t border-line bg-panel" style={{ height: tool ? height : undefined }} aria-label="Tools">
        {tool && (
          <div
            className="flex h-2.5 cursor-row-resize touch-none items-center justify-center"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Drag to resize the tools"
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture(e.pointerId);
              drag.current = { y: e.clientY, h: height };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              setHeight(Math.max(160, Math.min(window.innerHeight - 140, drag.current.h + drag.current.y - e.clientY)));
            }}
            onPointerUp={() => (drag.current = null)}
          >
            <span className="h-1 w-10 rounded-full bg-line" />
          </div>
        )}
        <nav className="flex items-center gap-1 overflow-x-auto px-2 py-1.5" aria-label="Tools">
          {TOOLS.map((t) => (
            <button
              key={t.to}
              onClick={() => navigate(tool?.to === t.to ? "/" : t.to)}
              aria-pressed={tool?.to === t.to}
              className={`flex shrink-0 items-center gap-2 rounded-[9px] px-3 py-1.5 text-[13px] font-semibold ${tool?.to === t.to ? "bg-sign text-sign-ink" : "text-muted hover:bg-panel-2 hover:text-ink"}`}
              title={`${t.t} (${t.key})`}
            >
              {t.t}
              {t.to === "/log" && log.length > 0 && <span className={`rounded-full px-1.5 font-mono text-[11px] ${tool?.to === t.to ? "bg-white/20" : "bg-panel-2"}`}>{acted ? `${acted}/${log.length}` : log.length}</span>}
            </button>
          ))}
          <span className="flex-1" />
          {tool && (
            <button className="btn h-7 px-2.5 text-[12px]" onClick={() => navigate("/")} aria-label="Close the tools">
              Close
            </button>
          )}
        </nav>
        {tool && (
          <div className="scroll-y min-h-0 flex-1 border-t border-line px-4 py-4 sm:px-6">
            <Routes>
              <Route path="/log" element={<Log />} />
              <Route path="/scanner" element={<Scanner />} />
              <Route path="/integrate" element={<Integrate />} />
              <Route path="/results" element={<Results />} />
            </Routes>
            <p className="mt-8 text-xs text-faint">
              Built by{" "}
              <a href="https://vishwanathan.dev" className="text-muted underline underline-offset-4">
                Vishwanathan R
              </a>
              . Northwind Telecom and Nova are made up. Everything here runs in your browser.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  </StrictMode>,
);
