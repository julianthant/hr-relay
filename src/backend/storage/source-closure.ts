export class AuthoritySourceClosureUnprovedError extends AggregateError {
  constructor(errors: readonly unknown[]) {
    super(errors, "authority-source-closure-unproved", { cause: errors[0] });
    this.name = "AuthoritySourceClosureUnprovedError";
  }
}

type RetainedSourceOwners = Readonly<{
  snapshot?: Readonly<{ path: string; assertUnchanged(): void; dispose(): void }>;
  database?: object;
  directory?: object;
  descriptor?: Readonly<{ descriptor: number; identity?: object }>;
  backupSource?: Readonly<{ close(): void }>;
  admission?: object;
  restore?: object;
  restoreCreation?: object;
  processLock?: object;
  operationProof?: object;
}>;
const retainedSourceClosures = new WeakMap<AuthoritySourceClosureUnprovedError, RetainedSourceOwners>();

export function retainAuthoritySourceClosure(errors: readonly unknown[], owners: RetainedSourceOwners): AuthoritySourceClosureUnprovedError {
  const failure = new AuthoritySourceClosureUnprovedError(errors);
  retainedSourceClosures.set(failure, owners);
  return failure;
}

export function hasUnprovedSourceClosure(error: unknown): boolean {
  const pending: unknown[] = [error], seen = new Set<unknown>();
  while (pending.length !== 0) {
    const value = pending.pop();
    if (seen.has(value)) continue;
    seen.add(value);
    if (value instanceof AuthoritySourceClosureUnprovedError) return true;
    if (value instanceof AggregateError) { const errors: readonly unknown[] = value.errors; pending.push(...errors); }
    if (value instanceof Error && value.cause !== undefined) pending.push(value.cause);
  }
  return false;
}

export function retainUnprovedSourceOwners(error: unknown, owners: RetainedSourceOwners): void {
  const pending: unknown[] = [error], seen = new Set<unknown>();
  while (pending.length !== 0) {
    const value = pending.pop();
    if (seen.has(value)) continue;
    seen.add(value);
    if (value instanceof AuthoritySourceClosureUnprovedError) retainedSourceClosures.set(value, { ...retainedSourceClosures.get(value), ...owners });
    if (value instanceof AggregateError) { const errors: readonly unknown[] = value.errors; pending.push(...errors); }
    if (value instanceof Error && value.cause !== undefined) pending.push(value.cause);
  }
}
