import { useCallback, useEffect, useRef, useState } from "react";

/** Loads data now and every `intervalMs`, pausing while the tab is hidden. */
export function usePoll<T>(load: () => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
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
    return [(routes as readonly string[]).includes(path) ? (path as T) : fallback, decodeURIComponent(arg)];
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
