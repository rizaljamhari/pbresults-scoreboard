export type RefreshTask = (token: string, shouldApply: () => boolean) => Promise<void>;

type RefreshCoordinatorOptions = {
  debounceMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

export class ResourceRefreshCoordinator {
  private readonly task: RefreshTask;
  private readonly debounceMs: number;
  private readonly setTimer: NonNullable<RefreshCoordinatorOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<RefreshCoordinatorOptions["clearTimer"]>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private dirtyWhileRunning = false;
  private disposed = false;
  private token = "initial";

  constructor(task: RefreshTask, options: RefreshCoordinatorOptions = {}) {
    this.task = task;
    this.debounceMs = options.debounceMs ?? 100;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  invalidate(token: string): void {
    if (this.disposed) return;
    this.token = token;
    if (this.running) {
      this.dirtyWhileRunning = true;
      return;
    }
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.start();
    }, this.debounceMs);
  }

  refreshNow(token = this.token): void {
    if (this.disposed) return;
    this.token = token;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.running) {
      this.dirtyWhileRunning = true;
      return;
    }
    void this.start();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private async start(): Promise<void> {
    if (this.disposed || this.running) return;
    this.running = true;
    this.dirtyWhileRunning = false;
    const runToken = this.token;
    const shouldApply = () => !this.disposed && !this.dirtyWhileRunning && runToken === this.token;
    try {
      await this.task(runToken, shouldApply);
    } finally {
      this.running = false;
      if (!this.disposed && this.dirtyWhileRunning) {
        this.dirtyWhileRunning = false;
        await this.start();
      }
    }
  }
}
