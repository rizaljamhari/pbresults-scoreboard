import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { defaultSettings } from "../shared/theme";
import type { AppSettings, NormalizedLiveState, OperatorTextState, StoredAsset, TeamRecord, ThemeDefinition } from "../shared/theme";
import type { RuntimeInfo } from "./api";
import type { UpdateStatus } from "../shared/update";
import type { AppResourceDomain } from "../shared/appEvents";
import { useAppEventLiveState, useAppEventOperatorTextState, useAppEvents } from "./appEvents";
import { ResourceRefreshCoordinator } from "./resourceRefresh";

let resourceRefreshToken = 0;

function nextResourceRefreshToken(prefix: string) {
  resourceRefreshToken += 1;
  return `${prefix}:${resourceRefreshToken}`;
}

function versionAssetUrl(url: string, token: string) {
  const parsed = new URL(url, window.location.origin);
  parsed.searchParams.set("v", token);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function useSettings() {
  return useResource(api.getSettings, [], { domain: "settings", refreshOnEvents: true });
}

export function useThemes() {
  return useResource(api.getThemes, [], { domain: "themes", refreshOnEvents: true });
}

export function useTheme(id: string | undefined, refreshOnEvents = false) {
  return useResource(() => (id ? api.getTheme(id) : Promise.resolve(null)), [id], {
    domain: "themes",
    resourceId: id,
    refreshOnEvents
  });
}

export function useAssets() {
  return useResource(api.getAssets, [], {
    domain: "assets",
    refreshOnEvents: true,
    transform: (assets, token) => assets.map((asset) => ({ ...asset, url: versionAssetUrl(asset.url, token) }))
  });
}

export function useRuntimeInfo() {
  return useResource<RuntimeInfo>(api.getRuntimeInfo, []);
}

export function useRuntimeVersionWatcher() {
  const appEvents = useAppEvents();
  const loadedVersionRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    const check = async () => {
      controller = new AbortController();
      try {
        const runtime = await api.getRuntimeInfo(controller.signal);
        if (!active) return;
        if (!loadedVersionRef.current) {
          loadedVersionRef.current = runtime.appVersion;
          return;
        }
        if (runtime.appVersion === loadedVersionRef.current) return;
        const key = `pbresults-version-reload:${runtime.appVersion}`;
        const lastReload = Number(sessionStorage.getItem(key) ?? 0);
        if (Date.now() - lastReload < 60_000) return;
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
      } catch {
        // Restarts and offline periods are expected; the next poll retries.
      } finally {
        controller = null;
        if (active && appEvents?.connectionState === "disconnected") {
          timer = window.setTimeout(() => void check(), 60_000);
        }
      }
    };
    if (!loadedVersionRef.current || appEvents?.connectionState === "disconnected") void check();
    return () => {
      active = false;
      controller?.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [appEvents?.connectionState]);
}

export function useUpdateStatus() {
  const [data, setData] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const status = await api.getUpdateStatus();
        if (!active) return;
        setData(status);
        setError(null);
        const busy = ["checking", "downloading", "verifying", "staging", "install-requested", "restarting"].includes(status.phase);
        timer = window.setTimeout(() => void load(), busy ? 1000 : 10_000);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load update status");
        timer = window.setTimeout(() => void load(), 5000);
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return { data, error, setData };
}

export function useTeams() {
  return useResource(api.getTeams, [], { domain: "teams", refreshOnEvents: true });
}

export function useLiveState(poll = true, pollIntervalMs = defaultSettings.pollIntervalMs) {
  const state = useAppEventLiveState();
  const appEvents = useAppEvents();
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    const repeat = poll && appEvents?.connectionState === "disconnected";

    const load = async () => {
      controller = new AbortController();
      try {
        const live = await api.getLive(controller.signal);
        if (!active) {
          return;
        }
        appEvents?.updateLiveState(live);
        setError(null);
      } catch (err) {
        if (!active || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load live state");
      } finally {
        controller = null;
        if (active && repeat) {
          timer = window.setTimeout(() => void load(), Math.max(100, pollIntervalMs));
        }
      }
    };

    if (!state || repeat) void load();

    return () => {
      active = false;
      controller?.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [appEvents?.connectionState, appEvents?.updateLiveState, Boolean(state), poll, pollIntervalMs]);

  useEffect(() => {
    if (state) setError(null);
  }, [state]);

  useEffect(() => {
    if (!poll) return;
    const clockId = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(clockId);
  }, [poll]);

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

export function useOperatorTextState() {
  const data = useAppEventOperatorTextState();
  const appEvents = useAppEvents();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    const repeat = appEvents?.connectionState === "disconnected";

    const load = async () => {
      controller = new AbortController();
      try {
        const next = await api.getOperatorTextFields(controller.signal);
        if (active) {
          appEvents?.updateOperatorTextState(next);
          setError(null);
        }
      } catch (err) {
        if (active && !(err instanceof DOMException && err.name === "AbortError")) {
          setError(err instanceof Error ? err.message : "Failed to load operator text");
        }
      } finally {
        controller = null;
        if (active && repeat) timer = window.setTimeout(() => void load(), 2000);
      }
    };

    if (!data || repeat) void load();

    return () => {
      active = false;
      controller?.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [appEvents?.connectionState, appEvents?.updateOperatorTextState, Boolean(data)]);

  useEffect(() => {
    if (data) setError(null);
  }, [data]);

  return { data, error, setData: appEvents?.updateOperatorTextState };
}

export function useAutoCloseRowActionMenus() {
  useEffect(() => {
    function closeAll(except?: HTMLDetailsElement | null) {
      document.querySelectorAll<HTMLDetailsElement>(".row-action-menu[open]").forEach((menu) => {
        if (menu !== except) {
          menu.open = false;
        }
      });
    }

    function onPointerDown(event: PointerEvent) {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }

      const menuRoot = event.target.closest(".row-action-menu");
      if (!(menuRoot instanceof HTMLDetailsElement)) {
        closeAll();
        return;
      }

      closeAll(menuRoot);
    }

    function onClick(event: MouseEvent) {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }

      const action = event.target.closest(".row-action-menu-list button, .row-action-menu-list a");
      if (!action) {
        return;
      }

      const menuRoot = event.target.closest(".row-action-menu");
      if (!(menuRoot instanceof HTMLDetailsElement)) {
        return;
      }

      window.setTimeout(() => {
        menuRoot.open = false;
      }, 0);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      closeAll();
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

type ResourceOptions<T> = {
  domain?: AppResourceDomain;
  resourceId?: string;
  refreshOnEvents?: boolean;
  transform?: (value: T, refreshToken: string) => T;
};

function useResource<T>(loader: () => Promise<T>, deps: unknown[], options: ResourceOptions<T> = {}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appEvents = useAppEvents();
  const loaderRef = useRef(loader);
  const transformRef = useRef(options.transform);
  const dataRef = useRef(data);
  const coordinatorRef = useRef<ResourceRefreshCoordinator | null>(null);
  loaderRef.current = loader;
  transformRef.current = options.transform;
  dataRef.current = data;

  const refresh = useCallback(() => {
    setStale(true);
    coordinatorRef.current?.refreshNow(nextResourceRefreshToken("manual"));
  }, []);

  useEffect(() => {
    let active = true;
    let retryTimer: number | undefined;
    let coordinator: ResourceRefreshCoordinator;
    coordinator = new ResourceRefreshCoordinator(async (token, shouldApply) => {
      if (dataRef.current === null) setLoading(true);
      else setRefreshing(true);
      try {
        const loaded = await loaderRef.current();
        if (!active || !shouldApply()) return;
        if (retryTimer) {
          window.clearTimeout(retryTimer);
          retryTimer = undefined;
        }
        const next = transformRef.current ? transformRef.current(loaded, token) : loaded;
        dataRef.current = next;
        setData(next);
        setError(null);
        setStale(false);
      } catch (err) {
        if (!active || !shouldApply()) return;
        setError(err instanceof Error ? err.message : "Request failed");
        setStale(true);
        if (!retryTimer) {
          retryTimer = window.setTimeout(() => {
            retryTimer = undefined;
            coordinator.invalidate(nextResourceRefreshToken("retry"));
          }, 5000);
        }
      } finally {
        if (active && shouldApply()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    });
    coordinatorRef.current = coordinator;
    coordinator.refreshNow(nextResourceRefreshToken("initial"));

    const unsubscribe = options.domain && options.refreshOnEvents
      ? appEvents?.subscribe(options.domain, (invalidation) => {
          if (options.resourceId && invalidation.resourceIds && !invalidation.resourceIds.includes(options.resourceId)) {
            return;
          }
          setStale(true);
          coordinator.invalidate(invalidation.cacheToken);
        })
      : undefined;

    return () => {
      active = false;
      unsubscribe?.();
      coordinator.dispose();
      if (retryTimer) window.clearTimeout(retryTimer);
      if (coordinatorRef.current === coordinator) coordinatorRef.current = null;
    };
  }, [appEvents?.subscribe, options.domain, options.refreshOnEvents, options.resourceId, ...deps]);

  return { data, loading, refreshing, stale, error, setData, refresh };
}

export type Resource<T> = ReturnType<typeof useResource<T>>;
export type SettingsResource = { data: AppSettings | null; loading: boolean; error: string | null };
export type ThemeResource = { data: ThemeDefinition | null; loading: boolean; error: string | null };
export type AssetsResource = { data: StoredAsset[] | null; loading: boolean; error: string | null };
export type TeamsResource = { data: TeamRecord[] | null; loading: boolean; error: string | null };
