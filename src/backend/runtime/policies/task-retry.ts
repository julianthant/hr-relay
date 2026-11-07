export function shouldRetryTaskFailure(transient: boolean, taskAttempt: number, maxAttempts: number): boolean {
  return transient && taskAttempt < maxAttempts;
}
