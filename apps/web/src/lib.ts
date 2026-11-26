import { useEffect, useState, useSyncExternalStore } from "react";
import { DEFAULT_POLICY, deserialize, type Action, type Finding, type Model, type Policy } from "@airlock/core";

let modelPromise: Promise<Model> | null = null;
/** The trained classifier, loaded once. Everything else in the engine is code. */
export function loadModel(): Promise<Model> {
  modelPromise ??= fetch("/classifier.json")
    .then((r) => {
      if (!r.ok) throw new Error("Couldn't load the classifier.");
      return r.json();
    })
    .then(deserialize);
  return modelPromise;
}

export function useModel() {
  const [m, setM] = useState<Model | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadModel().then(setM, (e: Error) => setError(e.message));
  }, []);
  return { model: m, error };
}

// The policy lives in this browser for the demo; the proxy keeps its own on the server.
const POLICY_KEY = "airlock-policy-v1";
let policy: Policy = (() => {
  try {
    const raw = localStorage.getItem(POLICY_KEY);
    return raw ? { ...DEFAULT_POLICY, ...JSON.parse(raw) } : DEFAULT_POLICY;
  } catch {
    return DEFAULT_POLICY;
  }
})();
const policyListeners = new Set<() => void>();
export function setPolicy(p: Policy) {
  policy = p;
  try {
    localStorage.setItem(POLICY_KEY, JSON.stringify(p));
  } catch {
    /* private window: keep it in memory */
  }
  policyListeners.forEach((f) => f());
}
export const usePolicy = () =>
  useSyncExternalStore(
    (f) => (policyListeners.add(f), () => policyListeners.delete(f)),
    () => policy,
  );

/** Everything that passed through the checkpoint in this browser, newest first. */
export type LogEntry = { id: number; at: number; direction: "in" | "out"; action: Action; findings: Finding[]; preview: string; ms: number };
let log: LogEntry[] = [];
let nextId = 1;
const logListeners = new Set<() => void>();
export function record(e: Omit<LogEntry, "id" | "at">) {
  log = [{ ...e, id: nextId++, at: Date.now() }, ...log].slice(0, 300);
  logListeners.forEach((f) => f());
}
export const useLog = () =>
  useSyncExternalStore(
    (f) => (logListeners.add(f), () => logListeners.delete(f)),
    () => log,
  );

export const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

