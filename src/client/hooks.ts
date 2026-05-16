import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { defaultSettings } from "../shared/theme";
import type { AppSettings, NormalizedLiveState, StoredAsset, TeamRecord, ThemeDefinition } from "../shared/theme";

export function useSettings() {
  return useResource(api.getSettings, []);
}

export function useThemes() {
  return useResource(api.getThemes, []);
}

export function useTheme(id: string | undefined) {
  return useResource(() => (id ? api.getTheme(id) : Promise.resolve(null)), [id]);
}

export function useAssets() {
  return useResource(api.getAssets, []);
}

export function useTeams() {
  return useResource(api.getTeams, []);
}

export function useLiveState(poll = true, pollIntervalMs = defaultSettings.pollIntervalMs) {
  const [state, setState] = useState<NormalizedLiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    let clockId: number | undefined;
    let fallbackIntervalId: number | undefined;
    let stream: EventSource | null = null;

    const load = async () => {
      try {
        const live = await api.getLive();
        if (!active) {
          return;
        }
        setState(live);
        setError(null);
      } catch (err) {
        if (!active) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load live state");
      }
    };

    void load();
    if (poll) {
      stream = new EventSource("/api/live/stream");
      stream.onmessage = (event) => {
        if (!active) {
          return;
        }
        try {
          setState(JSON.parse(event.data) as NormalizedLiveState);
          setError(null);
        } catch {
          setError("Failed to parse live stream");
        }
      };
      stream.onerror = () => {
        if (!active) {
          return;
        }
        if (stream) {
          stream.close();
          stream = null;
        }
        if (!fallbackIntervalId) {
          fallbackIntervalId = window.setInterval(() => void load(), Math.max(100, pollIntervalMs));
        }
      };
      clockId = window.setInterval(() => {
        setNowMs(Date.now());
      }, 250);
    }

    return () => {
      active = false;
      if (stream) {
        stream.close();
      }
      if (fallbackIntervalId) {
        window.clearInterval(fallbackIntervalId);
      }
      if (clockId) {
        window.clearInterval(clockId);
      }
    };
  }, [poll, pollIntervalMs]);

  const derivedState = useMemo(() => {
    if (!state || state.sourceStatus !== "ok" || !state.fetchedAt) {
      return state;
    }

    const fetchedAtMs = Date.parse(state.fetchedAt);
    if (Number.isNaN(fetchedAtMs)) {
      return state;
    }

    const elapsedSeconds = Math.max(0, Math.floor((nowMs - fetchedAtMs) / 1000));
    if (elapsedSeconds === 0) {
      return state;
    }

    return {
      ...state,
      breakTimer: {
        ...state.breakTimer,
        value: state.breakTimer.state === 2 ? Math.max(0, state.breakTimer.value - elapsedSeconds) : state.breakTimer.value
      },
      gameTimer: {
        ...state.gameTimer,
        value: state.gameTimer.state === 2 ? Math.max(0, state.gameTimer.value - elapsedSeconds) : state.gameTimer.value
      }
    };
  }, [nowMs, state]);

  return { data: derivedState, error };
}
function useResource<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loader()
      .then((next) => {
        if (!active) {
          return;
        }
        setData(next);
        setError(null);
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        setError(err instanceof Error ? err.message : "Request failed");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, deps);

  return { data, loading, error, setData };
}

export type Resource<T> = ReturnType<typeof useResource<T>>;
export type SettingsResource = { data: AppSettings | null; loading: boolean; error: string | null };
export type ThemeResource = { data: ThemeDefinition | null; loading: boolean; error: string | null };
export type AssetsResource = { data: StoredAsset[] | null; loading: boolean; error: string | null };
export type TeamsResource = { data: TeamRecord[] | null; loading: boolean; error: string | null };
