/** A small single-flight boundary for service-worker command and maintenance work. */
export class SerialCycle {
  private running = false;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly onSettled: () => void) {}

  async run(processCommands: () => Promise<void>, afterCommands?: () => Promise<void>): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      await processCommands();
      if (afterCommands) await afterCommands();
      return true;
    } finally {
      this.release();
    }
  }

  /** Queue state-mutating work that must never be skipped while another cycle owns the boundary. */
  async enqueue(work: () => Promise<void>, afterWork?: () => Promise<void>): Promise<void> {
    await this.acquire();
    try {
      await work();
      if (afterWork) await afterWork();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (!this.running) {
      this.running = true;
      return;
    }
    await new Promise<void>(resolve => { this.waiters.push(resolve); });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.running = false;
    this.onSettled();
  }
}

/** Coalesces tab-close events and retains failures for the next serialized cycle. */
export class PendingTabClosures {
  private readonly pending = new Map<number, number>();

  constructor(private readonly forgetClosed: (tabId: number) => Promise<void>) {}

  record(tabId: number): void {
    this.pending.set(tabId, (this.pending.get(tabId) ?? 0) + 1);
  }

  async drain(): Promise<void> {
    for (const [tabId, generation] of [...this.pending]) {
      try {
        await this.forgetClosed(tabId);
        if (this.pending.get(tabId) === generation) this.pending.delete(tabId);
      } catch {
        // Retain the id. The next serialized cycle retries without losing the event.
      }
    }
  }

  get size(): number { return this.pending.size; }
}
