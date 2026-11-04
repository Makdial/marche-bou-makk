import { useEffect, useState } from 'react';
import { useLive } from './live';
import { tr } from './i18n';

interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

// Loads data and reloads automatically whenever a realtime notification arrives.
export function useApi<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const { tick } = useLive();
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, loading: true });

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true }));
    load()
      .then((data) => {
        if (active) setState({ data, error: null, loading: false });
      })
      .catch((error: Error) => {
        if (active) setState((current) => ({ data: current.data, error: error.message, loading: false }));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, version, ...deps]);

  return { ...state, reload: () => setVersion((value) => value + 1) };
}

// Tracks a button-triggered request: disables the UI while it runs and keeps the error message.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('common.genericError'));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, run, setError };
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
