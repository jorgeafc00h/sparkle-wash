import { useCallback, useEffect, useRef, useState } from "react";
import { useLive } from "./context";
import type { ChangeTopic } from "./types";

/**
 * Loads data now, again whenever the server announces a change to one of `topics`,
 * and every `intervalMs` as a fallback (paused while the tab is hidden).
 */
export function usePoll<T>(load: () => Promise<T>, intervalMs: number, topics: ChangeTopic[] = [], deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, intervalMs, ...deps]);

  const live = useLive();
  const topicKey = topics.join(",");
  useEffect(() => {
    if (!topicKey) return;
    const wanted = new Set(topicKey.split(","));
    return live.listen((topic) => { if (wanted.has(topic)) void refresh(); });
  }, [live, topicKey, refresh]);

  return { data, error, refresh, loading: data === null && error === null };
}

/** Re-renders every second so timers on job cards tick without refetching. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useHashRoute<T extends string>(routes: readonly T[], fallback: T): [T, string, (route: T, arg?: string) => void] {
  const parse = (): [T, string] => {
    const [path, arg = ""] = window.location.hash.replace(/^#\/?/, "").split("/");
    return [(routes as readonly string[]).includes(path) ? (path as T) : fallback, safeDecode(arg)];
  };
  const [state, setState] = useState(parse);
  useEffect(() => {
    const onChange = () => setState(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const go = useCallback((route: T, arg?: string) => {
    window.location.hash = `/${route}${arg ? `/${encodeURIComponent(arg)}` : ""}`;
  }, []);
  return [state[0], state[1], go];
}

/** A malformed link (e.g. "%E0") must not crash the console. */
function safeDecode(text: string): string {
  try { return decodeURIComponent(text); } catch { return ""; }
}
