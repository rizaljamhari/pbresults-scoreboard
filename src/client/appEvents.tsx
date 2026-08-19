import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from "react";
import {
  appChangedEventTypes,
  appEventSchema,
  appEventTypeToDomain,
  appRealtimeEventTypes,
  appResourceDomains,
  parseAppEventMessage,
  type AppChangedEvent,
  type AppEvent,
  type AppEventSnapshot,
  type AppResourceDomain,
  type AppResourceRevisions,
  type RuntimeIdentity
} from "../shared/appEvents";
import type { NormalizedLiveState, OperatorTextState } from "../shared/theme";

export type AppEventConnectionState = "connecting" | "open" | "disconnected";

export type ResourceInvalidation = {
  domain: AppResourceDomain;
  resourceIds?: string[];
  reason: "event" | "snapshot" | "fallback" | "lifecycle";
  cacheToken: string;
};

type ResourceInvalidationListener = (invalidation: ResourceInvalidation) => void;
type StoreListener = () => void;

type AppEventsContextValue = {
  connectionState: AppEventConnectionState;
  subscribe(domain: AppResourceDomain, listener: ResourceInvalidationListener): () => void;
  subscribeLive(listener: StoreListener): () => void;
  getLiveState(): NormalizedLiveState | null;
  updateLiveState(state: NormalizedLiveState): void;
  subscribeOperatorText(listener: StoreListener): () => void;
  getOperatorTextState(): OperatorTextState | null;
  updateOperatorTextState(state: OperatorTextState): void;
};

const AppEventsContext = createContext<AppEventsContextValue | null>(null);
const relayConnectMessage = "pbresults:event-relay:connect";
const relayCloseMessage = "pbresults:event-relay:close";
const relayEventMessage = "pbresults:event-relay:event";
const relayStateMessage = "pbresults:event-relay:state";

function sameRuntime(left: RuntimeIdentity, right: RuntimeIdentity) {
  return left.appVersion === right.appVersion && left.releaseTag === right.releaseTag;
}

function emptySubscribe() {
  return () => undefined;
}

function getNullLiveState() {
  return null;
}

function getNullOperatorTextState() {
  return null;
}

export function AppEventProvider({ children }: { children: ReactNode }) {
  const [connectionState, setConnectionState] = useState<AppEventConnectionState>("connecting");
  const listenersRef = useRef(new Map<AppResourceDomain, Set<ResourceInvalidationListener>>());
  const liveListenersRef = useRef(new Set<StoreListener>());
  const operatorTextListenersRef = useRef(new Set<StoreListener>());
  const liveStateRef = useRef<NormalizedLiveState | null>(null);
  const operatorTextStateRef = useRef<OperatorTextState | null>(null);
  const instanceIdRef = useRef<string | null>(null);
  const revisionsRef = useRef<AppResourceRevisions | null>(null);
  const runtimeRef = useRef<RuntimeIdentity | null>(null);
  const fallbackGenerationRef = useRef(0);
  const connectionStateRef = useRef<AppEventConnectionState>("connecting");

  const subscribe = useCallback((domain: AppResourceDomain, listener: ResourceInvalidationListener) => {
    const listeners = listenersRef.current.get(domain) ?? new Set<ResourceInvalidationListener>();
    listeners.add(listener);
    listenersRef.current.set(domain, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) listenersRef.current.delete(domain);
    };
  }, []);

  const subscribeLive = useCallback((listener: StoreListener) => {
    liveListenersRef.current.add(listener);
    return () => liveListenersRef.current.delete(listener);
  }, []);
  const getLiveState = useCallback(() => liveStateRef.current, []);
  const updateLiveState = useCallback((state: NormalizedLiveState) => {
    liveStateRef.current = state;
    for (const listener of [...liveListenersRef.current]) listener();
  }, []);

  const subscribeOperatorText = useCallback((listener: StoreListener) => {
    operatorTextListenersRef.current.add(listener);
    return () => operatorTextListenersRef.current.delete(listener);
  }, []);
  const getOperatorTextState = useCallback(() => operatorTextStateRef.current, []);
  const updateOperatorTextState = useCallback((state: OperatorTextState) => {
    operatorTextStateRef.current = state;
    for (const listener of [...operatorTextListenersRef.current]) listener();
  }, []);

  const notify = useCallback((invalidation: ResourceInvalidation) => {
    for (const listener of [...(listenersRef.current.get(invalidation.domain) ?? [])]) {
      listener(invalidation);
    }
  }, []);

  const notifyAll = useCallback((reason: ResourceInvalidation["reason"]) => {
    fallbackGenerationRef.current += 1;
    for (const domain of appResourceDomains) {
      notify({
        domain,
        reason,
        cacheToken: `fallback:${fallbackGenerationRef.current}:${domain}`
      });
    }
  }, [notify]);

  useEffect(() => {
    let source: EventSource | null = null;
    let relayPort: MessagePort | null = null;
    let relayReady = false;
    let initialTimeout: number | undefined;
    let relayTimeout: number | undefined;
    let fallbackInterval: number | undefined;
    let wasHidden = document.visibilityState !== "visible";
    const childPorts = new Set<MessagePort>();
    const embedded = new URLSearchParams(window.location.search).get("embeddedEvents") === "1" && window.parent !== window;

    const sendToChildren = (message: unknown) => {
      for (const port of [...childPorts]) {
        try {
          port.postMessage(message);
        } catch {
          childPorts.delete(port);
          port.close();
        }
      }
    };
    const setTransportState = (state: AppEventConnectionState) => {
      connectionStateRef.current = state;
      setConnectionState(state);
      if (window.parent === window) {
        sendToChildren({ kind: relayStateMessage, state });
      }
    };
    const stopFallback = () => {
      if (initialTimeout) {
        window.clearTimeout(initialTimeout);
        initialTimeout = undefined;
      }
      if (fallbackInterval) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = undefined;
      }
    };
    const startFallback = () => {
      setTransportState("disconnected");
      if (!fallbackInterval) {
        fallbackInterval = window.setInterval(() => notifyAll("fallback"), 60_000);
      }
    };
    const startInitialTimeout = () => {
      if (!initialTimeout) initialTimeout = window.setTimeout(startFallback, 10_000);
    };
    const reloadForRuntime = (runtime: RuntimeIdentity) => {
      const previous = runtimeRef.current;
      runtimeRef.current = runtime;
      if (!previous || sameRuntime(previous, runtime)) return false;
      const identity = `${runtime.appVersion}:${runtime.releaseTag ?? "none"}`;
      const key = `pbresults-runtime-reload:${identity}`;
      const lastReload = Number(sessionStorage.getItem(key) ?? 0);
      if (Date.now() - lastReload < 60_000) return false;
      sessionStorage.setItem(key, String(Date.now()));
      window.location.reload();
      return true;
    };
    const handleSnapshot = (snapshot: AppEventSnapshot) => {
      stopFallback();
      setTransportState("open");
      if (reloadForRuntime(snapshot.runtime)) return;

      instanceIdRef.current = snapshot.instanceId;
      revisionsRef.current = { ...snapshot.revisions };
      if (snapshot.liveState) updateLiveState(snapshot.liveState);
      if (snapshot.operatorTextState) updateOperatorTextState(snapshot.operatorTextState);

      for (const domain of appResourceDomains) {
        notify({
          domain,
          reason: "snapshot",
          cacheToken: `${snapshot.instanceId}:${snapshot.revisions[domain]}`
        });
      }
    };
    const handleChanged = (event: AppChangedEvent) => {
      if (instanceIdRef.current !== event.instanceId || !revisionsRef.current) return;
      const domain = appEventTypeToDomain[event.type];
      if (event.revision <= revisionsRef.current[domain]) return;
      revisionsRef.current = { ...revisionsRef.current, [domain]: event.revision };
      notify({
        domain,
        resourceIds: event.resourceIds,
        reason: "event",
        cacheToken: `${event.instanceId}:${event.revision}`
      });
    };
    const dispatchEvent = (event: AppEvent, forward = true) => {
      if (event.type === "system.snapshot") handleSnapshot(event);
      else if (event.type === "live.state") updateLiveState(event.state);
      else if (event.type === "operator-text.state") updateOperatorTextState(event.state);
      else handleChanged(event);

      if (forward && window.parent === window) {
        sendToChildren({ kind: relayEventMessage, event });
      }
    };
    const onEvent = (rawEvent: Event) => {
      const message = rawEvent as MessageEvent<string>;
      const parsed = parseAppEventMessage(rawEvent.type, message.data);
      if (parsed) dispatchEvent(parsed);
    };
    const openEventSource = () => {
      if (source) return;
      setTransportState("connecting");
      source = new EventSource("/api/events");
      for (const type of ["system.snapshot", ...appChangedEventTypes, ...appRealtimeEventTypes]) {
        source.addEventListener(type, onEvent);
      }
      source.onerror = startFallback;
      startInitialTimeout();
    };
    const onRelayMessage = (message: MessageEvent<unknown>) => {
      const value = message.data as { kind?: unknown; event?: unknown; state?: unknown } | null;
      if (!value || typeof value !== "object") return;
      relayReady = true;
      if (relayTimeout) {
        window.clearTimeout(relayTimeout);
        relayTimeout = undefined;
      }
      if (source) {
        source.close();
        source = null;
      }
      if (value.kind === relayEventMessage) {
        const parsed = appEventSchema.safeParse(value.event);
        if (parsed.success) dispatchEvent(parsed.data, false);
      } else if (value.kind === relayStateMessage) {
        if (value.state === "open") {
          stopFallback();
          setTransportState("open");
        } else if (value.state === "disconnected") {
          startFallback();
        } else if (value.state === "connecting") {
          setTransportState("connecting");
          startInitialTimeout();
        }
      }
    };
    const connectToParent = () => {
      const channel = new MessageChannel();
      relayPort = channel.port1;
      relayPort.onmessage = onRelayMessage;
      relayPort.start();
      window.parent.postMessage({ kind: relayConnectMessage, protocol: 1 }, window.location.origin, [channel.port2]);
      relayTimeout = window.setTimeout(() => {
        if (!relayReady) openEventSource();
      }, 1000);
      startInitialTimeout();
    };
    const onWindowMessage = (message: MessageEvent<unknown>) => {
      if (window.parent !== window || message.origin !== window.location.origin) return;
      const value = message.data as { kind?: unknown; protocol?: unknown } | null;
      const port = message.ports[0];
      if (!value || value.kind !== relayConnectMessage || value.protocol !== 1 || !port) return;
      childPorts.add(port);
      port.onmessage = (portMessage) => {
        const portValue = portMessage.data as { kind?: unknown } | null;
        if (portValue?.kind === relayCloseMessage) {
          childPorts.delete(port);
          port.close();
        }
      };
      port.start();
      port.postMessage({ kind: relayStateMessage, state: source?.readyState === EventSource.OPEN ? "open" : connectionStateRef.current });
      if (instanceIdRef.current && revisionsRef.current && runtimeRef.current) {
        port.postMessage({
          kind: relayEventMessage,
          event: {
            protocol: 1,
            type: "system.snapshot",
            instanceId: instanceIdRef.current,
            sequence: 0,
            occurredAt: new Date().toISOString(),
            revisions: revisionsRef.current,
            runtime: runtimeRef.current,
            ...(liveStateRef.current ? { liveState: liveStateRef.current } : {}),
            ...(operatorTextStateRef.current ? { operatorTextState: operatorTextStateRef.current } : {})
          }
        });
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        wasHidden = true;
        return;
      }
      if (wasHidden || (!relayReady && source?.readyState !== EventSource.OPEN)) notifyAll("lifecycle");
      wasHidden = false;
    };
    const onOnline = () => notifyAll("lifecycle");

    if (window.parent === window) window.addEventListener("message", onWindowMessage);
    if (embedded) connectToParent();
    else openEventSource();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);

    return () => {
      stopFallback();
      if (relayTimeout) window.clearTimeout(relayTimeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("message", onWindowMessage);
      source?.close();
      if (relayPort) {
        relayPort.postMessage({ kind: relayCloseMessage });
        relayPort.close();
      }
      for (const port of childPorts) port.close();
      childPorts.clear();
    };
  }, [notify, notifyAll, updateLiveState, updateOperatorTextState]);

  const value = useMemo(
    () => ({
      connectionState,
      subscribe,
      subscribeLive,
      getLiveState,
      updateLiveState,
      subscribeOperatorText,
      getOperatorTextState,
      updateOperatorTextState
    }),
    [
      connectionState,
      getLiveState,
      getOperatorTextState,
      subscribe,
      subscribeLive,
      subscribeOperatorText,
      updateLiveState,
      updateOperatorTextState
    ]
  );
  return <AppEventsContext.Provider value={value}>{children}</AppEventsContext.Provider>;
}

export function useAppEvents() {
  return useContext(AppEventsContext);
}

export function useAppEventLiveState() {
  const events = useAppEvents();
  return useSyncExternalStore(events?.subscribeLive ?? emptySubscribe, events?.getLiveState ?? getNullLiveState, getNullLiveState);
}

export function useAppEventOperatorTextState() {
  const events = useAppEvents();
  return useSyncExternalStore(
    events?.subscribeOperatorText ?? emptySubscribe,
    events?.getOperatorTextState ?? getNullOperatorTextState,
    getNullOperatorTextState
  );
}
