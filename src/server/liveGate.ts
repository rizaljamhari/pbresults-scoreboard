import type { NormalizedLiveState } from "../shared/theme.js";

/**
 * The one place that decides which live state the overlay and admin see: the real feed, or rehearsal frames
 * while a rehearsal runs. The poller keeps polling either way, so the real state is ready the moment a
 * rehearsal ends.
 */
export class LiveGate {
  private rehearsalState: NormalizedLiveState | null = null;

  constructor(
    private readonly getFeedState: () => NormalizedLiveState,
    private readonly publish: (state: NormalizedLiveState) => void
  ) {}

  current(): NormalizedLiveState {
    return this.rehearsalState ?? this.getFeedState();
  }

  get source(): "feed" | "rehearsal" {
    return this.rehearsalState ? "rehearsal" : "feed";
  }

  /** A new real feed state; published only when no rehearsal holds the screen. */
  feedChanged(state: NormalizedLiveState) {
    if (!this.rehearsalState) this.publish(state);
  }

  showRehearsal(state: NormalizedLiveState) {
    this.rehearsalState = state;
    this.publish(state);
  }

  /** Back to the real feed straight away. */
  endRehearsal() {
    if (!this.rehearsalState) return;
    this.rehearsalState = null;
    this.publish(this.getFeedState());
  }
}
