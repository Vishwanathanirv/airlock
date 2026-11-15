import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource/jetbrains-mono/400.css";
import "./index.css";
import { time, useLog } from "./lib";
import { Checkpoint } from "./pages/Checkpoint";
import { Integrate } from "./pages/Integrate";
import { Results } from "./pages/Results";
import { Scanner } from "./pages/Scanner";
import { CATEGORY_NAME, Gate } from "./xray";

/** Wayfinding pictograms, drawn simply like airport signage. */
const PICTO: Record<string, ReactNode> = {
  checkpoint: <path d="M3 18V9a7 7 0 0 1 14 0v9M1 19h18M8 12h4v4H8z" />,
  scanner: <path d="M2 4h16v11H2zM6 18h8M5 8h3m2 0h5M5 11h7" />,
  results: <path d="M3 17V9m5 8V4m5 13v-6m5 6V7M1 18h18" />,
  integrate: <path d="M7 5 2 10l5 5m6-10 5 5-5 5" />,
  log: <path d="M4 3h12v14H4zM7 7h6M7 10h6M7 13h4" />,
};
const NAV = [
  { to: "/", t: "Checkpoint", icon: "checkpoint" },
  { to: "/scanner", t: "X-ray", icon: "scanner" },
  { to: "/results", t: "Results", icon: "results" },
  { to: "/integrate", t: "Use it", icon: "integrate" },
  { to: "/log", t: "Log", icon: "log" },
];

function Log() {
  const log = useLog();
  return (
    <div>
      <h1 className="text-[2.2rem] font-extrabold leading-[1.05] tracking-[-0.02em]">Log</h1>
      <p className="mt-3 max-w-2xl text-[1.02rem] leading-relaxed text-muted">Everything that went through the checkpoint in this browser. On a server, the same entries come from GET /api/events (with the admin token), with personal data already redacted.</p>
      <div className="panel mt-6 overflow-x-auto">
        {log.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">Time</th>
                <th className="px-2 py-2.5 font-medium">Direction</th>
                <th className="px-2 py-2.5 font-medium">Verdict</th>
                <th className="px-2 py-2.5 font-medium">Found</th>
                <th className="px-4 py-2.5 font-medium">Text</th>
              </tr>
            </thead>
            <tbody>
              {log.map((e) => (
                <tr key={e.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted">{time(e.at)}</td>
                  <td className="px-2 py-2.5">{e.direction === "in" ? "Into the model" : "Out to the user"}</td>
                  <td className="px-2 py-2.5">
                    <Gate action={e.action} size="sm" />
                  </td>
                  <td className="px-2 py-2.5 text-muted">{[...new Set(e.findings.map((f) => CATEGORY_NAME[f.category]))].join(", ") || "Nothing"}</td>
                  <td className="max-w-md truncate px-4 py-2.5 text-muted">{e.preview.replace(/[\u{E0000}-\u{E007F}]/gu, "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-12 text-center text-muted">
            Nothing yet. Send a message on the <Link to="/" className="underline underline-offset-4">checkpoint</Link>.
          </p>
        )}
      </div>
    </div>
  );
}

function Shell() {
  return (
    <div className="min-h-dvh">
      {/* Overhead signage: where you are and where you can go. */}
      <header className="sign sticky top-0 z-30">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2.5 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 pr-2 text-[1.35rem] font-extrabold tracking-tight">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            Airlock
          </Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end className={({ isActive }) => `inline-flex shrink-0 items-center gap-2 rounded-[5px] px-3 py-1.5 text-[15px] ${isActive ? "bg-[var(--sign-ink)] text-[var(--sign)]" : "text-[var(--sign-ink)] hover:bg-white/10"}`}>
                <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
                  {PICTO[n.icon]}
                </svg>
                {n.t}
              </NavLink>
            ))}
          </nav>
          <a href="https://github.com/Vishwanathanirv/llm-firewall" className="hidden text-sm font-medium text-white/70 hover:text-white sm:block">
            Source on GitHub
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6">
        <Routes>
          <Route path="/" element={<Checkpoint />} />
          <Route path="/scanner" element={<Scanner />} />
          <Route path="/results" element={<Results />} />
          <Route path="/integrate" element={<Integrate />} />
          <Route path="/log" element={<Log />} />
          <Route path="*" element={<p className="text-muted">There's no page here. Follow a sign above.</p>} />
        </Routes>
      </main>
      <footer className="mx-auto max-w-[1240px] px-4 pb-8 text-xs text-faint sm:px-6">
        Built by{" "}
        <a href="https://vishwanathan.dev" className="text-muted underline underline-offset-4">
          Vishwanathan R
        </a>
        . Northwind Telecom and Nova are made up. Everything on this page runs in your browser.
      </footer>
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
