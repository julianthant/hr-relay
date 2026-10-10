
export interface MonotonicDeadlineHandle {
  cancel(): void;
}

export interface MonotonicDeadlineScheduler {
  schedule(deadlineMonotonicMs: number, onDeadline: () => void): MonotonicDeadlineHandle;
}
