/**
 * The kernel-owned monotonic deadline/cancellation channel (docs 01/05).
 *
 * One injected port arms every bound the kernel enforces — provider admission
 * deadlines (D112) and the interpreter's immutable task deadlines and retry
 * backoffs (doc 05 §5.5) — so a test drives time explicitly and production
 * composition supplies one real timer implementation. A bound armed on an
 * ad-hoc `setTimeout` would be invisible to both.
 */
export interface MonotonicDeadlineHandle {
  cancel(): void;
}

export interface MonotonicDeadlineScheduler {
  schedule(deadlineMonotonicMs: number, onDeadline: () => void): MonotonicDeadlineHandle;
}
