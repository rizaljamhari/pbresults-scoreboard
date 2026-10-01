import { useEffect, useRef, useState } from "react";
import type { NormalizedLiveState, ThemeDefinition } from "../../shared/theme";

const BREAK_TIMEOUT_DEFAULT_THRESHOLD_SECONDS = 45;

type TimeoutSettings = Pick<ThemeDefinition["momentOverlays"]["timeout"], "enabled" | "durationMs" | "minIncreaseSeconds">;

/**
 * A timeout is called when, between two consecutive break ticks, the break clock jumps up by at least the
 * threshold. A jump from a nearly expired clock (10 s or less) is the next break starting, not a timeout.
 */
export function isTimeoutJump(previous: NormalizedLiveState, live: NormalizedLiveState, minIncreaseSeconds: number) {
  const inBreakNow = live.period === "BREAK" && live.state !== "END";
  const wasInBreak = previous.period === "BREAK" && previous.state !== "END";
  if (!inBreakNow || !wasInBreak) {
    return false;
  }
  if (previous.breakTimer.value <= 10) {
    return false;
  }
  const increase = live.breakTimer.value - previous.breakTimer.value;
  const threshold = minIncreaseSeconds || BREAK_TIMEOUT_DEFAULT_THRESHOLD_SECONDS;
  return increase >= threshold && live.breakTimer.value >= threshold;
}

/** Token for the timeout card while it is showing; cleared after the card's duration. */
export function useTimeoutToken(live: NormalizedLiveState | null, settings: TimeoutSettings, suppressed: boolean) {
  const [token, setToken] = useState<number | null>(null);
  const previousLiveRef = useRef<NormalizedLiveState | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!settings.enabled) {
      previousLiveRef.current = live;
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      setToken(null);
      return;
    }

    if (!live || live.sourceStatus !== "ok") {
      previousLiveRef.current = live;
      return;
    }

    const previous = previousLiveRef.current;
    previousLiveRef.current = live;

    if (!previous || suppressed || !isTimeoutJump(previous, live, settings.minIncreaseSeconds)) {
      return;
    }

    const next = Date.now();
    setToken(next);
    if (clearTimerRef.current !== null) {
      clearTimeout(clearTimerRef.current);
    }
    clearTimerRef.current = window.setTimeout(() => {
      setToken((current) => (current === next ? null : current));
      clearTimerRef.current = null;
    }, settings.durationMs);
  }, [live, suppressed, settings.enabled, settings.durationMs, settings.minIncreaseSeconds]);

  return token;
}
