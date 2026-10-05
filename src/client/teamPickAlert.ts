import { useEffect, useRef, useState } from "react";
import type { NormalizedLiveState, TeamMatchResult } from "../shared/theme";
import { setTitlePrefix } from "./documentTitle";

const STORAGE_KEY = "pbresults.admin.teamPickSound";
const TITLE_PREFIX = "● Pick team · ";

/** Same rule the Operations page uses to show the picker on a side. */
export function sideNeedsPick(match: TeamMatchResult) {
  return Boolean(match.inputName.trim()) && match.status !== "matched" && match.resolutionSource !== "manual";
}

function pendingKeys(live: NormalizedLiveState | null | undefined) {
  const keys = new Set<string>();
  if (!live) return keys;
  for (const [side, match] of [
    ["left", live.displayLeftTeamMatch],
    ["right", live.displayRightTeamMatch]
  ] as const) {
    if (sideNeedsPick(match)) keys.add(`${side}:${match.inputName.trim().toLowerCase()}`);
  }
  return keys;
}

function readSoundOn() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function hasUserActivation() {
  return typeof navigator !== "undefined" && "userActivation" in navigator ? navigator.userActivation.hasBeenActive : false;
}

let audio: AudioContext | null = null;

function audioContext() {
  if (!audio) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audio = new Ctor();
  }
  return audio;
}

/** Two bursts of three short square-wave beeps. Generated live so there is no sound file to ship. */
export function playTeamPickChime() {
  const ctx = audioContext();
  if (!ctx) return;
  void ctx.resume();
  const peak = 0.11;
  for (const offset of [0, 0.11, 0.22, 0.5, 0.61, 0.72]) {
    const start = ctx.currentTime + offset;
    const duration = 0.08;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 1500;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.005);
    gain.gain.setValueAtTime(peak, start + duration * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.05);
  }
}

/**
 * Alerts the operator when a side newly needs a team pick: plays the chime once per new feed name and marks the tab
 * title while anything is waiting. Names already waiting when the page loads mark the title but stay silent.
 */
export function useTeamPickAlert(live: NormalizedLiveState | null | undefined) {
  const [soundOn, setSoundOnState] = useState(readSoundOn);
  // Browsers refuse to start audio until the page has had a click or key press.
  const [unlocked, setUnlocked] = useState(hasUserActivation);
  const previousRef = useRef<Set<string> | null>(null);
  const keys = pendingKeys(live);
  const signature = [...keys].sort().join("|");

  useEffect(() => {
    if (unlocked) return;
    const unlock = () => {
      setUnlocked(true);
      void audioContext()?.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [unlocked]);

  useEffect(() => {
    if (!live) return;
    const current = new Set(signature ? signature.split("|") : []);
    const previous = previousRef.current;
    previousRef.current = current;
    if (!previous || !soundOn) return;
    if ([...current].some((key) => !previous.has(key))) {
      playTeamPickChime();
    }
  }, [live, signature, soundOn]);

  const waiting = keys.size > 0;
  useEffect(() => {
    if (!waiting) return;
    setTitlePrefix(TITLE_PREFIX);
    return () => setTitlePrefix("");
  }, [waiting]);

  function setSoundOn(next: boolean) {
    setSoundOnState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      // Not remembered; the choice still applies until reload.
    }
    if (next) playTeamPickChime();
  }

  return { soundOn, setSoundOn, blocked: soundOn && !unlocked };
}
