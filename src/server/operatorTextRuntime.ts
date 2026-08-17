import type { OperatorTextState } from "../shared/theme.js";
import { getOperatorTextState } from "./storage.js";

type OperatorTextListener = (state: OperatorTextState) => void;

class OperatorTextRuntime {
  private listeners = new Set<OperatorTextListener>();

  getState(): OperatorTextState {
    return getOperatorTextState();
  }

  subscribe(listener: OperatorTextListener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitCurrent() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

export const operatorTextRuntime = new OperatorTextRuntime();
